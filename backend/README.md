# Backend

Backend API dùng ASP.NET Core (.NET 10) theo hướng modular monolith: một API triển khai độc lập, chia module theo nghiệp vụ để có thể tách dịch vụ khi cần.

## Chạy API từ thư mục `backend`

Thư mục `backend` chứa project trong `InvoiceManagementSystem.Api`; vì vậy khi chạy từ `backend`, cần chỉ định file project:

```powershell
cd E:\InvoiceManagementSystem\backend
dotnet run --project .\InvoiceManagementSystem.Api\InvoiceManagementSystem.Api.csproj --launch-profile InvoiceManagementSystem.Api
```

Chạy `dotnet run` trực tiếp không kèm `--project` chỉ dùng được khi terminal đang ở `backend/InvoiceManagementSystem.Api`, nơi có file `.csproj`. Task VS Code cũng đã đặt working directory là `backend` và trỏ tới project con.

## Khung thư mục

- `InvoiceManagementSystem.Api/` — HTTP API, cấu hình ứng dụng và điểm khởi chạy `Program.cs`.
- `InvoiceManagementSystem.Api/Modules/Identity/` — đăng nhập, tài khoản và vai trò.
- `InvoiceManagementSystem.Api/Modules/Invoices/` — nghiệp vụ hóa đơn.
- `InvoiceManagementSystem.Api/Modules/Customers/` — hồ sơ khách hàng.
- `InvoiceManagementSystem.Api/Modules/Staff/` — nghiệp vụ nhân viên.
- `InvoiceManagementSystem.Api/Modules/Administration/` — quản trị hệ thống.
- `InvoiceManagementSystem.Api/Infrastructure/` — tích hợp hạ tầng; hiện có cấu hình EF Core/PostgreSQL.
- `InvoiceManagementSystem.Api/Contracts/` — hợp đồng API dùng chung khi được thiết kế.

API quản trị hiện có các endpoint tài khoản, vai trò/quyền, hóa đơn, báo cáo và tồn kho dưới `/api/v1/admin`. Các endpoint này yêu cầu phiên cookie quản trị. Frontend quản trị gọi trực tiếp các API này.

Khu vực nhân viên dùng phiên cookie theo vai trò Staff. Quản trị viên tạo tài khoản có vai trò Staff tại trang quản lý tài khoản; tài khoản Staff đăng nhập từ trang chính và được chuyển đến `/staff/`. Nhân viên có thể tra cứu khách hàng, tạo/cập nhật hóa đơn và xác nhận thanh toán. API nhân viên nằm dưới `/api/v1/staff`:

- `POST /api/v1/auth/staff/login`, `GET /api/v1/auth/staff/session`, `POST /api/v1/auth/staff/logout`
- `GET /api/v1/staff/overview`, `GET /api/v1/staff/customers?search=...`
- `GET/POST /api/v1/staff/invoices`, `PATCH /api/v1/staff/invoices/{id}`
- `POST /api/v1/staff/invoices/{id}/confirm-payment`

Các endpoint nghiệp vụ Staff yêu cầu phiên đăng nhập Staff; xác nhận thanh toán đổi trạng thái hóa đơn sang `Paid`.

Khu vực khách hàng đăng nhập bằng tài khoản `Customer` đã đăng ký và dùng các endpoint dưới `/api/v1/customer` để sửa hồ sơ, xem hóa đơn theo tên tài khoản, tra cứu trạng thái và xem thông báo trạng thái hiện tại. Endpoint `POST /api/v1/customer/invoices/{id}/pay` là luồng thanh toán demo: đổi trạng thái hóa đơn sang `Paid`, chưa kết nối cổng thanh toán thật.

## PostgreSQL

`Program.cs` đăng ký `InvoiceDbContext` với provider Npgsql. Connection string được đọc từ `ConnectionStrings:PostgreSql`.

Backend kết nối PostgreSQL cài trực tiếp trên máy qua `localhost:5432`; Docker không cần thiết. Kiểm tra dịch vụ bằng `Get-Service *postgres*` và khởi động dịch vụ PostgreSQL nếu đang dừng. `appsettings.json` mặc định dùng database `invoicemanagementsystem` và user `postgres`; nếu mật khẩu local của bạn khác, cập nhật connection string hoặc đặt biến môi trường `ConnectionStrings__PostgreSql` trước khi chạy API.

Để đặt mật khẩu không nằm trong file cấu hình:

```powershell
cd backend/InvoiceManagementSystem.Api
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:PostgreSql" "Host=localhost;Port=5432;Database=invoice_management;Username=postgres;Password=your_password"
dotnet run
```

Hoặc dùng biến môi trường `ConnectionStrings__PostgreSql`. `appsettings.json` chỉ có thông tin mẫu; thay `CHANGE_ME` trước khi chạy kết nối thật.

`GET /health` kiểm tra khả năng kết nối PostgreSQL; `GET /health/live` chỉ xác nhận tiến trình API đang chạy.

Khi khởi động, ứng dụng dùng EF Core `EnsureCreated` để tạo các bảng `UserAccounts`, `Roles`, `Invoices` và `InventoryItems` nếu database chưa có schema. Ứng dụng cũng tạo các vai trò mặc định `Admin`, `Staff`, `Customer` và đồng bộ tài khoản quản trị cấu hình vào bảng tài khoản. Với database đã có schema được quản lý bằng migrations, hãy chuyển sang migrations trước khi phát hành.

Các endpoint chính (đều cần cookie quản trị ngoại trừ auth/health):

- `GET/POST /api/v1/admin/accounts`, `PATCH/DELETE /api/v1/admin/accounts/{id}`
- `GET /api/v1/admin/roles`, `PUT /api/v1/admin/roles/{name}`
- `GET/POST /api/v1/admin/invoices`, `PATCH/DELETE /api/v1/admin/invoices/{id}`
- `GET /api/v1/admin/reports`, `GET /api/v1/admin/overview`
- `GET/POST /api/v1/admin/inventory`, `PUT/DELETE /api/v1/admin/inventory/{id}`

Đăng ký công khai chỉ tạo tài khoản `Customer` qua `POST /api/v1/auth/register`; vai trò gửi từ trình duyệt không được chấp nhận. Tài khoản mới được lưu vào cùng bảng `UserAccounts` mà `GET /api/v1/admin/accounts` sử dụng, kèm họ tên, email và số điện thoại. Khi nâng cấp từ schema cũ, startup bổ sung cột `Phone` nếu chưa có.

Tài khoản mới lưu mật khẩu dạng PBKDF2-SHA256; API không trả hash/salt về frontend.

## Tài khoản quản trị viên khởi tạo

Hiện chỉ có một tài khoản quản trị viên được cấu hình: tên đăng nhập `Vinhly`. Mật khẩu được lưu dưới dạng PBKDF2-SHA256 hash trong `appsettings.json`, không lưu dạng văn bản thuần. API cung cấp `POST /api/v1/auth/admin/login`, `GET /api/v1/auth/admin/session` và `POST /api/v1/auth/admin/logout`; phiên đăng nhập dùng cookie HttpOnly.

Đây là tài khoản ban đầu dành cho môi trường phát triển. Trước khi triển khai công khai, thay thông tin xác thực và đưa salt/hash vào User Secrets hoặc secret store của môi trường triển khai.

Trang đăng nhập có chức năng quên mật khẩu cho tài khoản Admin. Vì project chưa cấu hình SMTP/email, ở Development API trả mã xác minh dùng một lần (10 phút) để giao diện hiển thị; ở môi trường khác API không trả mã và cần cấu hình dịch vụ gửi email trước khi bật tính năng này.
