# Hệ thống quản lý hóa đơn

Project gồm frontend HTML/CSS/JavaScript, backend ASP.NET Core API (.NET 10) và PostgreSQL.

## Cổng chạy thống nhất

| Thành phần | Địa chỉ |
| --- | --- |
| Frontend | `http://localhost:5500` |
| Backend API | `http://localhost:5000` |
| API readiness (kiểm tra cả PostgreSQL) | `http://localhost:5000/health` |
| PostgreSQL | `localhost:5432` |

Luôn mở frontend bằng `localhost` để cookie đăng nhập quản trị hoạt động với API cùng hostname. Không dùng `0.0.0.0` làm địa chỉ trên trình duyệt; đó chỉ là địa chỉ bind của server.

## Chạy từ PowerShell

Trước tiên bật Docker Desktop, sau đó tại thư mục gốc khởi động PostgreSQL:

```powershell
docker compose up -d postgres
```

Mở hai cửa sổ PowerShell riêng. Chạy backend từ thư mục `backend`; lệnh trỏ rõ tới project `.csproj` nằm bên trong:

```powershell
cd E:\InvoiceManagementSystem\backend
dotnet run --project .\InvoiceManagementSystem.Api\InvoiceManagementSystem.Api.csproj --launch-profile InvoiceManagementSystem.Api
```

Ở cửa sổ còn lại, chạy frontend:

```powershell
python -m http.server 5500 --bind 127.0.0.1
```


Truy cập `http://localhost:5500/` hoặc `http://localhost:5500/admin/`. Giữ hai cửa sổ terminal mở trong khi sử dụng.

## Chạy từ VS Code

Mở thư mục gốc `E:\InvoiceManagementSystem`, chọn **Terminal → Run Task…**, rồi chạy lần lượt:

1. `Backend API (localhost:5000)`
2. `Frontend (localhost:5500)`

Hai task chạy trong terminal riêng, dùng cùng cổng và hostname như lệnh PowerShell ở trên.

Xem [backend/README.md](backend/README.md) để biết API, tài khoản quản trị và cấu hình PostgreSQL.
