using System.Security.Claims;
using System.Security.Cryptography;
using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using InvoiceManagementSystem.Api.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("PostgreSql")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:PostgreSql configuration.");

builder.Services.AddDbContext<InvoiceDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(options =>
{
    options.Cookie.Name = ".InvoiceManagement.Admin";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    options.ExpireTimeSpan = TimeSpan.FromHours(8);
    options.SlidingExpiration = true;
    options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
    options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddPolicy("Frontend", policy =>
{
    if (allowedOrigins.Length > 0) policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
}));

var app = builder.Build();
var resetCodes = new ConcurrentDictionary<string, (string Code, DateTime ExpiresAt)>(StringComparer.Ordinal);
app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();

// Create the initial schema and administrator record for this starter application.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<InvoiceDbContext>();
    await db.Database.EnsureCreatedAsync();
    await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"UserAccounts\" ADD COLUMN IF NOT EXISTS \"Phone\" character varying(30) NOT NULL DEFAULT ''");
    await db.Database.ExecuteSqlRawAsync("ALTER TABLE \"Invoices\" ADD COLUMN IF NOT EXISTS \"ItemName\" character varying(200) NOT NULL DEFAULT ''");
    var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
    var adminName = config["AdminAccount:Username"] ?? "Vinhly";
    if (!await db.UserAccounts.AnyAsync(x => x.Username == adminName))
    {
        db.UserAccounts.Add(new UserAccount
        {
            Username = adminName, Email = "admin@invoiceflow.local",
            PasswordHash = config["AdminAccount:PasswordHash"] ?? "",
            PasswordSalt = config["AdminAccount:PasswordSalt"] ?? "",
            PasswordIterations = int.TryParse(config["AdminAccount:Iterations"], out var iterations) ? iterations : 600_000,
            Role = "Admin", IsActive = true
        });
    }
    foreach (var role in new[] { "Admin", "Staff", "Customer" })
        if (!await db.Roles.AnyAsync(x => x.Name == role)) db.Roles.Add(new RoleDefinition { Name = role, PermissionsJson = JsonSerializer.Serialize(role == "Admin" ? new[] { "accounts", "permissions", "invoices", "reports", "inventory" } : role == "Staff" ? new[] { "invoices", "inventory" } : new[] { "invoices" }) });
    await db.SaveChangesAsync();
}

app.MapGet("/health/live", () => Results.Ok(new { status = "ok" })).WithName("ApiLiveness");
app.MapGet("/health", async Task<IResult> (InvoiceDbContext db) =>
{
    try { return await db.Database.CanConnectAsync() ? Results.Ok(new { status = "ok", database = "connected" }) : Results.StatusCode(503); }
    catch { return Results.StatusCode(503); }
}).WithName("ApiReadiness");
app.MapPost("/api/v1/auth/register", async (RegisterCustomerRequest request, InvoiceDbContext db) =>
{
    var fullName = request.FullName?.Trim() ?? ""; var email = request.Email?.Trim().ToLowerInvariant() ?? ""; var phone = request.Phone?.Trim() ?? "";
    if (fullName.Length < 2 || fullName.Length > 120) return Results.BadRequest(new { message = "Họ và tên cần có từ 2 đến 120 ký tự." });
    if (email.Length is 0 or > 254 || !System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")) return Results.BadRequest(new { message = "Địa chỉ email không hợp lệ." });
    if (request.Password is null || request.Password.Length < 8) return Results.BadRequest(new { message = "Mật khẩu cần có ít nhất 8 ký tự." });
    if (phone.Length > 30) return Results.BadRequest(new { message = "Số điện thoại không được vượt quá 30 ký tự." });
    if (await db.UserAccounts.AnyAsync(x => x.Email.ToLower() == email)) return Results.Conflict(new { message = "Email này đã được sử dụng." });
    var username = fullName;
    if (await db.UserAccounts.AnyAsync(x => x.Username == username)) username = $"{fullName} ({Guid.NewGuid().ToString("N")[..6]})";
    var salt = RandomNumberGenerator.GetBytes(16); const int iterations = 600_000;
    var account = new UserAccount { Username = username, Email = email, Phone = phone, PasswordSalt = Convert.ToBase64String(salt), PasswordIterations = iterations, PasswordHash = Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(request.Password, salt, iterations, HashAlgorithmName.SHA256, 32)), Role = "Customer", IsActive = true };
    db.UserAccounts.Add(account);
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Results.Conflict(new { message = "Email hoặc tên tài khoản vừa được sử dụng. Hãy thử lại." }); }
    return Results.Created("/api/v1/auth/register", new { account.Id, account.Username, account.Email, account.Phone, account.Role, account.IsActive, account.CreatedAt });
}).WithName("CustomerRegistration");
app.MapPost("/api/v1/auth/admin/login", async (AdminLoginRequest request, HttpContext context, InvoiceDbContext db, IConfiguration configuration) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password)) return Results.Unauthorized();
    var primaryAdmin = configuration["AdminAccount:Username"] ?? "Vinhly";
    if (!string.Equals(request.Username, primaryAdmin, StringComparison.Ordinal)) return Results.Unauthorized();
    var account = await db.UserAccounts.SingleOrDefaultAsync(x => x.Username == primaryAdmin && x.Role == "Admin" && x.IsActive);
    if (account is null) return Results.Unauthorized();
    var username = account.Username;
    var expected = Convert.FromBase64String(account.PasswordHash);
    var salt = Convert.FromBase64String(account.PasswordSalt);
    var iterations = account.PasswordIterations;
    var actual = Rfc2898DeriveBytes.Pbkdf2(request.Password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
    if (!CryptographicOperations.FixedTimeEquals(actual, expected)) return Results.Unauthorized();
    var claims = new[] { new Claim(ClaimTypes.Name, username), new Claim(ClaimTypes.Role, "Admin") };
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    return Results.Ok(new { username, role = "Admin" });
}).WithName("AdminLogin");
app.MapPost("/api/v1/auth/admin/password-reset/request", async (PasswordResetRequest request, InvoiceDbContext db, IWebHostEnvironment environment) =>
{
    if (!environment.IsDevelopment()) return Results.StatusCode(501);
    if (string.IsNullOrWhiteSpace(request.Username)) return Results.BadRequest(new { message = "Vui lòng nhập tên đăng nhập." });
    var account = await db.UserAccounts.SingleOrDefaultAsync(x => x.Username == request.Username && x.Role == "Admin" && x.IsActive);
    if (account is null) return Results.Ok(new { message = "Nếu tài khoản phù hợp tồn tại, mã xác minh đã được tạo." });
    var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
    resetCodes[account.Username] = (code, DateTime.UtcNow.AddMinutes(10));
    return Results.Ok(new { message = "Mã xác minh có hiệu lực trong 10 phút.", developmentCode = code });
}).WithName("AdminPasswordResetRequest");
app.MapPost("/api/v1/auth/admin/password-reset/confirm", async (PasswordResetConfirm request, InvoiceDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Code) || string.IsNullOrEmpty(request.NewPassword) || request.NewPassword.Length < 8)
        return Results.BadRequest(new { message = "Nhập mã xác minh và mật khẩu mới tối thiểu 8 ký tự." });
    if (!resetCodes.TryGetValue(request.Username, out var reset) || reset.ExpiresAt < DateTime.UtcNow)
    {
        resetCodes.TryRemove(request.Username, out _);
        return Results.BadRequest(new { message = "Mã xác minh không hợp lệ hoặc đã hết hạn." });
    }
    var codeMatches = CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(reset.Code), Encoding.UTF8.GetBytes(request.Code));
    if (!codeMatches) return Results.BadRequest(new { message = "Mã xác minh không hợp lệ hoặc đã hết hạn." });
    var account = await db.UserAccounts.SingleOrDefaultAsync(x => x.Username == request.Username && x.Role == "Admin" && x.IsActive);
    if (account is null) return Results.BadRequest(new { message = "Không thể khôi phục tài khoản này." });
    var salt = RandomNumberGenerator.GetBytes(16);
    account.PasswordSalt = Convert.ToBase64String(salt);
    account.PasswordIterations = 600_000;
    account.PasswordHash = Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(request.NewPassword, salt, account.PasswordIterations, HashAlgorithmName.SHA256, 32));
    await db.SaveChangesAsync();
    resetCodes.TryRemove(request.Username, out _);
    return Results.Ok(new { message = "Đặt lại mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới." });
}).WithName("AdminPasswordResetConfirm");
app.MapGet("/api/v1/auth/admin/session", (ClaimsPrincipal user) => Results.Ok(new { username = user.Identity?.Name, role = "Admin" })).RequireAuthorization(policy => policy.RequireRole("Admin"));
app.MapPost("/api/v1/auth/admin/logout", async (HttpContext context) => { await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme); return Results.NoContent(); }).RequireAuthorization(policy => policy.RequireRole("Admin"));
app.MapPost("/api/v1/auth/staff/login", async (StaffLoginRequest request, HttpContext context, InvoiceDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password)) return Results.Unauthorized();
    var account = await db.UserAccounts.SingleOrDefaultAsync(x => x.Username == request.Username && x.Role == "Staff" && x.IsActive);
    if (account is null) return Results.Unauthorized();
    var expected = Convert.FromBase64String(account.PasswordHash); var salt = Convert.FromBase64String(account.PasswordSalt);
    var actual = Rfc2898DeriveBytes.Pbkdf2(request.Password, salt, account.PasswordIterations, HashAlgorithmName.SHA256, expected.Length);
    if (!CryptographicOperations.FixedTimeEquals(actual, expected)) return Results.Unauthorized();
    var claims = new[] { new Claim(ClaimTypes.Name, account.Username), new Claim(ClaimTypes.Role, "Staff") };
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    return Results.Ok(new { username = account.Username, role = "Staff" });
}).WithName("StaffLogin");
app.MapGet("/api/v1/auth/staff/session", (ClaimsPrincipal user) => Results.Ok(new { username = user.Identity?.Name, role = "Staff" })).RequireAuthorization(policy => policy.RequireRole("Staff"));
app.MapPost("/api/v1/auth/staff/logout", async (HttpContext context) => { await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme); return Results.NoContent(); }).RequireAuthorization(policy => policy.RequireRole("Staff"));

app.MapPost("/api/v1/auth/customer/login", async (StaffLoginRequest request, HttpContext context, InvoiceDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password)) return Results.Unauthorized();
    var account = await db.UserAccounts.SingleOrDefaultAsync(x => x.Username == request.Username.Trim() && x.Role == "Customer" && x.IsActive);
    if (account is null) return Results.Unauthorized();
    var expected = Convert.FromBase64String(account.PasswordHash); var salt = Convert.FromBase64String(account.PasswordSalt);
    var actual = Rfc2898DeriveBytes.Pbkdf2(request.Password, salt, account.PasswordIterations, HashAlgorithmName.SHA256, expected.Length);
    if (!CryptographicOperations.FixedTimeEquals(actual, expected)) return Results.Unauthorized();
    var claims = new[] { new Claim(ClaimTypes.Name, account.Username), new Claim(ClaimTypes.Role, "Customer") };
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme)));
    return Results.Ok(new { username = account.Username, role = "Customer" });
}).WithName("CustomerLogin");
app.MapGet("/api/v1/auth/customer/session", (ClaimsPrincipal user) => Results.Ok(new { username = user.Identity?.Name, role = "Customer" })).RequireAuthorization(policy => policy.RequireRole("Customer"));
app.MapPost("/api/v1/auth/customer/logout", async (HttpContext context) => { await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme); return Results.NoContent(); }).RequireAuthorization(policy => policy.RequireRole("Customer"));

var customer = app.MapGroup("/api/v1/customer").RequireAuthorization(policy => policy.RequireRole("Customer"));
customer.MapGet("/profile", async (ClaimsPrincipal user, InvoiceDbContext db) =>
{
    var account = await db.UserAccounts.AsNoTracking().SingleOrDefaultAsync(x => x.Username == user.Identity!.Name && x.Role == "Customer");
    if (account is null) return Results.NotFound();
    return Results.Ok(new { account.Username, account.Email, account.Phone });
});
customer.MapPatch("/profile", async (UpdateCustomerProfileRequest request, ClaimsPrincipal user, HttpContext context, InvoiceDbContext db) =>
{
    var account = await db.UserAccounts.SingleOrDefaultAsync(x => x.Username == user.Identity!.Name && x.Role == "Customer");
    if (account is null) return Results.NotFound();
    var username = request.Username?.Trim() ?? ""; var email = request.Email?.Trim().ToLowerInvariant() ?? ""; var phone = request.Phone?.Trim() ?? "";
    if (username.Length is < 2 or > 100) return Results.BadRequest(new { message = "Tên hiển thị cần có từ 2 đến 100 ký tự." });
    if (email.Length is 0 or > 254 || !System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^\s@]+@[^\s@]+\.[^\s@]+$")) return Results.BadRequest(new { message = "Địa chỉ email không hợp lệ." });
    if (phone.Length > 30) return Results.BadRequest(new { message = "Số điện thoại không được vượt quá 30 ký tự." });
    if (await db.UserAccounts.AnyAsync(x => x.Id != account.Id && (x.Username == username || x.Email.ToLower() == email))) return Results.Conflict(new { message = "Tên đăng nhập hoặc email đã được tài khoản khác sử dụng." });
    var previousUsername = account.Username; account.Username = username; account.Email = email; account.Phone = phone;
    if (previousUsername != username) await db.Invoices.Where(x => x.CustomerName == previousUsername).ExecuteUpdateAsync(setters => setters.SetProperty(x => x.CustomerName, username));
    await db.SaveChangesAsync();
    if (previousUsername != username) await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, username), new Claim(ClaimTypes.Role, "Customer")], CookieAuthenticationDefaults.AuthenticationScheme)));
    return Results.Ok(new { account.Username, account.Email, account.Phone });
});
customer.MapGet("/invoices", async (ClaimsPrincipal user, InvoiceDbContext db, string? search, string? status) =>
{
    var username = user.Identity!.Name!; var query = db.Invoices.AsNoTracking().Where(x => x.CustomerName == username);
    if (!string.IsNullOrWhiteSpace(search)) { var term = search.Trim().ToLower(); query = query.Where(x => x.Code.ToLower().Contains(term)); }
    if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
    return Results.Ok(await query.OrderByDescending(x => x.CreatedAt).ToListAsync());
});
customer.MapGet("/notifications", async (ClaimsPrincipal user, InvoiceDbContext db) =>
{
    var username = user.Identity!.Name!;
    var invoices = await db.Invoices.AsNoTracking().Where(x => x.CustomerName == username).OrderByDescending(x => x.CreatedAt).Take(20).ToListAsync();
    return Results.Ok(invoices.Select(x => new { x.Id, x.Code, x.Status, x.Amount, x.CreatedAt, Message = x.Status switch { "Paid" => "Hóa đơn đã được thanh toán.", "Overdue" => "Hóa đơn đã quá hạn thanh toán.", "Cancelled" => "Hóa đơn đã bị hủy.", _ => "Hóa đơn đang chờ thanh toán." } }));
});
customer.MapGet("/items", async (InvoiceDbContext db, string? search) =>
{
    var query = db.InventoryItems.AsNoTracking().Where(x => x.Quantity > 0);
    if (!string.IsNullOrWhiteSpace(search)) { var term = search.Trim().ToLower(); query = query.Where(x => x.Name.ToLower().Contains(term) || x.Sku.ToLower().Contains(term)); }
    return Results.Ok(await query.OrderBy(x => x.Name).Select(x => new { x.Id, x.Sku, x.Name, x.Quantity, x.UnitPrice, x.UpdatedAt }).ToListAsync());
});
customer.MapPost("/invoices/{id:guid}/pay", async (Guid id, ClaimsPrincipal user, InvoiceDbContext db) =>
{
    var invoice = await db.Invoices.SingleOrDefaultAsync(x => x.Id == id && x.CustomerName == user.Identity!.Name);
    if (invoice is null) return Results.NotFound();
    if (invoice.Status == "Paid") return Results.Conflict(new { message = "Hóa đơn này đã được thanh toán." });
    if (invoice.Status == "Cancelled") return Results.BadRequest(new { message = "Hóa đơn đã hủy nên không thể thanh toán." });
    invoice.Status = "Paid"; await db.SaveChangesAsync(); return Results.Ok(invoice);
});

var staff = app.MapGroup("/api/v1/staff").RequireAuthorization(policy => policy.RequireRole("Staff"));
staff.MapGet("/overview", async (InvoiceDbContext db) =>
{
    var invoices = await db.Invoices.AsNoTracking().ToListAsync();
    return Results.Ok(new { customerCount = await db.UserAccounts.CountAsync(x => x.Role == "Customer" && x.IsActive), invoiceCount = invoices.Count, pending = invoices.Count(x => x.Status == "Pending"), paid = invoices.Count(x => x.Status == "Paid"), overdue = invoices.Count(x => x.Status == "Overdue"), pendingAmount = invoices.Where(x => x.Status == "Pending").Sum(x => x.Amount), recentInvoices = invoices.OrderByDescending(x => x.CreatedAt).Take(8) });
});
staff.MapGet("/customers", async (InvoiceDbContext db, string? search) =>
{
    var query = db.UserAccounts.AsNoTracking().Where(x => x.Role == "Customer");
    if (!string.IsNullOrWhiteSpace(search)) { var term = search.Trim().ToLower(); query = query.Where(x => x.Username.ToLower().Contains(term) || x.Email.ToLower().Contains(term)); }
    return Results.Ok(await query.OrderBy(x => x.Username).Select(x => new { x.Id, x.Username, x.Email, x.Phone, x.IsActive, x.CreatedAt }).ToListAsync());
});
staff.MapGet("/inventory", async (InvoiceDbContext db) => Results.Ok(await db.InventoryItems.AsNoTracking().OrderBy(x => x.Name).ToListAsync()));
staff.MapGet("/invoices", async (InvoiceDbContext db, string? search, string? status) =>
{
    var query = db.Invoices.AsNoTracking().AsQueryable();
    if (!string.IsNullOrWhiteSpace(search)) { var term = search.Trim().ToLower(); query = query.Where(x => x.Code.ToLower().Contains(term) || x.CustomerName.ToLower().Contains(term) || x.ItemName.ToLower().Contains(term)); }
    if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
    return Results.Ok(await query.OrderByDescending(x => x.CreatedAt).ToListAsync());
});
staff.MapPost("/invoices", async (InvoiceRequest request, InvoiceDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.CustomerName) || request.Amount <= 0 || (request.ItemName?.Length ?? 0) > 200) return Results.BadRequest(new { message = "Tên khách hàng, tên mặt hàng hợp lệ và số tiền lớn hơn 0 là bắt buộc." });
    var invoice = new Invoice { Code = $"INV-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}", CustomerName = request.CustomerName.Trim(), ItemName = request.ItemName?.Trim() ?? "", Amount = request.Amount, Status = "Pending" };
    db.Invoices.Add(invoice); await db.SaveChangesAsync(); return Results.Created($"/api/v1/staff/invoices/{invoice.Id}", invoice);
});
staff.MapPatch("/invoices/{id:guid}", async (Guid id, UpdateInvoiceRequest request, InvoiceDbContext db) =>
{
    var invoice = await db.Invoices.FindAsync(id); if (invoice is null) return Results.NotFound();
    if (invoice.Status == "Paid") return Results.BadRequest(new { message = "Không thể chỉnh sửa hóa đơn đã thanh toán." });
    if (request.CustomerName is not null) { if (string.IsNullOrWhiteSpace(request.CustomerName)) return Results.BadRequest(new { message = "Tên khách hàng không hợp lệ." }); invoice.CustomerName = request.CustomerName.Trim(); }
    if (request.ItemName is not null) { if (request.ItemName.Length > 200) return Results.BadRequest(new { message = "Tên mặt hàng không được vượt quá 200 ký tự." }); invoice.ItemName = request.ItemName.Trim(); }
    if (request.Amount.HasValue) { if (request.Amount <= 0) return Results.BadRequest(new { message = "Số tiền phải lớn hơn 0." }); invoice.Amount = request.Amount.Value; }
    await db.SaveChangesAsync(); return Results.Ok(invoice);
});
staff.MapPost("/invoices/{id:guid}/confirm-payment", async (Guid id, InvoiceDbContext db) =>
{
    var invoice = await db.Invoices.FindAsync(id); if (invoice is null) return Results.NotFound();
    if (invoice.Status == "Cancelled") return Results.BadRequest(new { message = "Không thể xác nhận thanh toán cho hóa đơn đã hủy." });
    invoice.Status = "Paid"; await db.SaveChangesAsync(); return Results.Ok(invoice);
});

var admin = app.MapGroup("/api/v1/admin").RequireAuthorization(policy => policy.RequireRole("Admin"));
admin.MapGet("/overview", async (InvoiceDbContext db) =>
{
    var today = DateTime.UtcNow.Date;
    var invoices = await db.Invoices.AsNoTracking().ToListAsync();
    var revenue = invoices.Where(x => x.Status == "Paid" && x.CreatedAt >= today.AddDays(-30)).Sum(x => x.Amount);
    return Results.Ok(new { revenue, invoiceCount = invoices.Count, customerCount = await db.UserAccounts.CountAsync(x => x.Role == "Customer" && x.IsActive), pendingAmount = invoices.Where(x => x.Status == "Pending").Sum(x => x.Amount), paid = invoices.Count(x => x.Status == "Paid"), pending = invoices.Count(x => x.Status == "Pending"), overdue = invoices.Count(x => x.Status == "Overdue"), recentInvoices = invoices.OrderByDescending(x => x.CreatedAt).Take(8) });
});
admin.MapGet("/accounts", async (InvoiceDbContext db) => Results.Ok(await db.UserAccounts.AsNoTracking().OrderByDescending(x => x.CreatedAt).Select(x => new { x.Id, x.Username, x.Email, x.Phone, x.Role, x.IsActive, x.CreatedAt }).ToListAsync()));
admin.MapPost("/accounts", async (CreateAccountRequest request, InvoiceDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Email) || request.Password.Length < 8) return Results.BadRequest(new { message = "Tên đăng nhập, email và mật khẩu tối thiểu 8 ký tự là bắt buộc." });
    if (request.Role == "Admin") return Results.BadRequest(new { message = "Không thể tạo thêm tài khoản quản trị viên." });
    if (!await db.Roles.AnyAsync(x => x.Name == request.Role)) return Results.BadRequest(new { message = "Vai trò không tồn tại." });
    var salt = RandomNumberGenerator.GetBytes(16);
    var hash = Rfc2898DeriveBytes.Pbkdf2(request.Password, salt, 600_000, HashAlgorithmName.SHA256, 32);
    var account = new UserAccount { Username = request.Username.Trim(), Email = request.Email.Trim().ToLowerInvariant(), PasswordSalt = Convert.ToBase64String(salt), PasswordHash = Convert.ToBase64String(hash), Role = request.Role };
    db.UserAccounts.Add(account);
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Results.Conflict(new { message = "Tên đăng nhập hoặc email đã được sử dụng." }); }
    return Results.Created($"/api/v1/admin/accounts/{account.Id}", new { account.Id, account.Username, account.Email, account.Role, account.IsActive, account.CreatedAt });
});
admin.MapPatch("/accounts/{id:guid}", async (Guid id, UpdateAccountRequest request, InvoiceDbContext db, IConfiguration configuration) =>
{
    var account = await db.UserAccounts.FindAsync(id);
    if (account is null) return Results.NotFound();
    var primaryAdmin = configuration["AdminAccount:Username"] ?? "Vinhly";
    if (request.Role == "Admin" && account.Username != primaryAdmin) return Results.BadRequest(new { message = "Chỉ tài khoản quản trị chính được giữ vai trò Admin." });
    if (account.Username == primaryAdmin && ((request.Role is not null && request.Role != "Admin") || request.IsActive == false))
        return Results.BadRequest(new { message = "Không thể đổi vai trò hoặc khóa tài khoản quản trị chính." });
    if (!string.IsNullOrWhiteSpace(request.Role)) { if (!await db.Roles.AnyAsync(x => x.Name == request.Role)) return Results.BadRequest(new { message = "Vai trò không tồn tại." }); account.Role = request.Role; }
    if (request.IsActive.HasValue) account.IsActive = request.IsActive.Value;
    await db.SaveChangesAsync();
    return Results.Ok(new { account.Id, account.Username, account.Email, account.Role, account.IsActive, account.CreatedAt });
});
admin.MapDelete("/accounts/{id:guid}", async (Guid id, InvoiceDbContext db, ClaimsPrincipal user) =>
{
    var account = await db.UserAccounts.FindAsync(id);
    if (account is null) return Results.NotFound();
    if (account.Username == user.Identity?.Name) return Results.BadRequest(new { message = "Không thể xóa tài khoản đang đăng nhập." });
    db.UserAccounts.Remove(account); await db.SaveChangesAsync(); return Results.NoContent();
});
admin.MapGet("/roles", async (InvoiceDbContext db) => Results.Ok(await db.Roles.AsNoTracking().OrderBy(x => x.Name).Select(x => new { x.Name, Permissions = JsonSerializer.Deserialize<string[]>(x.PermissionsJson) ?? Array.Empty<string>() }).ToListAsync()));
admin.MapPut("/roles/{name}", async (string name, UpdateRoleRequest request, InvoiceDbContext db) =>
{
    var role = await db.Roles.FindAsync(name); if (role is null) return Results.NotFound();
    var allowed = new HashSet<string>(["accounts", "permissions", "invoices", "reports", "inventory"]);
    if (request.Permissions.Any(x => !allowed.Contains(x))) return Results.BadRequest(new { message = "Danh sách quyền không hợp lệ." });
    role.PermissionsJson = JsonSerializer.Serialize(request.Permissions.Distinct()); await db.SaveChangesAsync(); return Results.Ok(new { role.Name, request.Permissions });
});
admin.MapGet("/invoices", async (InvoiceDbContext db, string? status) =>
{
    var query = db.Invoices.AsNoTracking().AsQueryable(); if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
    return Results.Ok(await query.OrderByDescending(x => x.CreatedAt).ToListAsync());
});
admin.MapPost("/invoices", async (InvoiceRequest request, InvoiceDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.CustomerName) || request.Amount <= 0 || (request.ItemName?.Length ?? 0) > 200) return Results.BadRequest(new { message = "Tên khách hàng, tên mặt hàng hợp lệ và số tiền lớn hơn 0 là bắt buộc." });
    var invoice = new Invoice { Code = $"INV-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}", CustomerName = request.CustomerName.Trim(), ItemName = request.ItemName?.Trim() ?? "", Amount = request.Amount, Status = "Pending" };
    db.Invoices.Add(invoice); await db.SaveChangesAsync(); return Results.Created($"/api/v1/admin/invoices/{invoice.Id}", invoice);
});
admin.MapPatch("/invoices/{id:guid}", async (Guid id, UpdateInvoiceRequest request, InvoiceDbContext db) =>
{
    var invoice = await db.Invoices.FindAsync(id); if (invoice is null) return Results.NotFound();
    if (request.Status is not null && request.Status is not ("Pending" or "Paid" or "Overdue" or "Cancelled")) return Results.BadRequest(new { message = "Trạng thái không hợp lệ." });
    if (request.CustomerName is not null) { if (string.IsNullOrWhiteSpace(request.CustomerName)) return Results.BadRequest(new { message = "Tên khách hàng không hợp lệ." }); invoice.CustomerName = request.CustomerName.Trim(); }
    if (request.ItemName is not null) { if (request.ItemName.Length > 200) return Results.BadRequest(new { message = "Tên mặt hàng không được vượt quá 200 ký tự." }); invoice.ItemName = request.ItemName.Trim(); }
    if (request.Amount.HasValue) { if (request.Amount <= 0) return Results.BadRequest(new { message = "Số tiền phải lớn hơn 0." }); invoice.Amount = request.Amount.Value; }
    if (request.Status is not null) invoice.Status = request.Status;
    await db.SaveChangesAsync(); return Results.Ok(invoice);
});
admin.MapDelete("/invoices/{id:guid}", async (Guid id, InvoiceDbContext db) => { var invoice = await db.Invoices.FindAsync(id); if (invoice is null) return Results.NotFound(); db.Invoices.Remove(invoice); await db.SaveChangesAsync(); return Results.NoContent(); });
admin.MapGet("/reports", async (InvoiceDbContext db) =>
{
    var invoices = await db.Invoices.AsNoTracking().ToListAsync();
    var monthly = invoices.Where(x => x.Status == "Paid").GroupBy(x => new { x.CreatedAt.Year, x.CreatedAt.Month }).OrderBy(x => x.Key.Year).ThenBy(x => x.Key.Month).Select(x => new { x.Key.Year, x.Key.Month, Revenue = x.Sum(i => i.Amount), Count = x.Count() });
    return Results.Ok(new { totalRevenue = invoices.Where(x => x.Status == "Paid").Sum(x => x.Amount), invoiceCount = invoices.Count, paidCount = invoices.Count(x => x.Status == "Paid"), pendingAmount = invoices.Where(x => x.Status == "Pending").Sum(x => x.Amount), monthly });
});
admin.MapGet("/inventory", async (InvoiceDbContext db) => Results.Ok(await db.InventoryItems.AsNoTracking().OrderBy(x => x.Name).ToListAsync()));
admin.MapPost("/inventory", async (InventoryRequest request, InvoiceDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Sku) || string.IsNullOrWhiteSpace(request.Name) || request.Quantity < 0 || request.UnitPrice < 0 || request.ReorderLevel < 0) return Results.BadRequest(new { message = "Thông tin mặt hàng không hợp lệ." });
    var item = new InventoryItem { Sku = request.Sku.Trim(), Name = request.Name.Trim(), Quantity = request.Quantity, ReorderLevel = request.ReorderLevel, UnitPrice = request.UnitPrice };
    db.InventoryItems.Add(item); try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Results.Conflict(new { message = "Mã SKU đã tồn tại." }); }
    return Results.Created($"/api/v1/admin/inventory/{item.Id}", item);
});
admin.MapPut("/inventory/{id:guid}", async (Guid id, InventoryRequest request, InvoiceDbContext db) =>
{
    var item = await db.InventoryItems.FindAsync(id); if (item is null) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(request.Name) || request.Quantity < 0 || request.UnitPrice < 0 || request.ReorderLevel < 0) return Results.BadRequest(new { message = "Thông tin mặt hàng không hợp lệ." });
    item.Sku = request.Sku.Trim(); item.Name = request.Name.Trim(); item.Quantity = request.Quantity; item.ReorderLevel = request.ReorderLevel; item.UnitPrice = request.UnitPrice; item.UpdatedAt = DateTime.UtcNow;
    try { await db.SaveChangesAsync(); } catch (DbUpdateException) { return Results.Conflict(new { message = "Mã SKU đã tồn tại." }); } return Results.Ok(item);
});
admin.MapDelete("/inventory/{id:guid}", async (Guid id, InvoiceDbContext db) => { var item = await db.InventoryItems.FindAsync(id); if (item is null) return Results.NotFound(); db.InventoryItems.Remove(item); await db.SaveChangesAsync(); return Results.NoContent(); });

app.Run();

internal sealed record AdminLoginRequest(string Username, string Password);
internal sealed record RegisterCustomerRequest(string? FullName, string? Email, string Password, string? Phone);
internal sealed record StaffLoginRequest(string Username, string Password);
internal sealed record UpdateCustomerProfileRequest(string? Username, string? Email, string? Phone);
internal sealed record PasswordResetRequest(string Username);
internal sealed record PasswordResetConfirm(string Username, string Code, string NewPassword);
internal sealed record CreateAccountRequest(string Username, string Email, string Password, string Role);
internal sealed record UpdateAccountRequest(string? Role, bool? IsActive);
internal sealed record UpdateRoleRequest(string[] Permissions);
internal sealed record InvoiceRequest(string CustomerName, decimal Amount, string? ItemName = null);
internal sealed record UpdateInvoiceRequest(string? Status, string? CustomerName, decimal? Amount, string? ItemName = null);
internal sealed record InventoryRequest(string Sku, string Name, int Quantity, int ReorderLevel, decimal UnitPrice);
