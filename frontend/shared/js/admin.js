document.addEventListener("DOMContentLoaded", async () => {
  const api = window.APP_CONFIG?.apiBaseUrl ?? `http://${window.location.hostname}:5000`;
  const $ = (selector, root = document) => root.querySelector(selector);
  const moduleView = $("#module-view");
  const overview = $("#overview-content");
  const heading = $(".page-heading h1");
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const money = (amount) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount || 0);
  const date = (value) => new Intl.DateTimeFormat("vi-VN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  const request = async (path, options = {}) => {
    const response = await fetch(`${api}/api/v1/admin${path}`, { credentials: "include", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Yêu cầu thất bại (${response.status})`);
    }
    return response.status === 204 ? null : response.json();
  };
  const showError = (error) => { moduleView.hidden = false; overview.hidden = true; moduleView.innerHTML = `<section class="panel module-placeholder"><h2>Có lỗi khi tải dữ liệu</h2><p>${esc(error.message)}</p><button class="primary-button" id="retry-module" type="button">Thử lại</button></section>`; $("#retry-module")?.addEventListener("click", () => openModule(currentModule)); };
  let currentModule = "overview";
  let username = "Quản trị viên";

  try {
    const sessionResponse = await fetch(`${api}/api/v1/auth/admin/session`, { credentials: "include" });
    if (sessionResponse.status === 401 || sessionResponse.status === 403) { window.location.replace("../index.html"); return; }
    if (!sessionResponse.ok) throw new Error("Không xác thực được phiên quản trị.");
    const session = await sessionResponse.json(); username = session.username || username;
    const welcomeName = $("#welcome-name"); if (welcomeName) welcomeName.textContent = username;
    const adminAvatar = $("#admin-avatar"); if (adminAvatar) adminAvatar.textContent = username.slice(0, 1).toLocaleUpperCase("vi");
    const todayLabel = $("#today-label"); if (todayLabel) todayLabel.textContent = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
    await loadOverview();
    $("#admin-loading").hidden = true; $("#admin-content").hidden = false;
  } catch (error) { const loading = $("#admin-loading"); if (loading) loading.textContent = `Không tải được trang quản trị: ${error.message}`; else console.error("Không tải được trang quản trị:", error); return; }

  async function loadOverview() {
    try {
      const data = await request("/overview");
      renderNotifications(data);
      const values = $$(".metric-card .metric-value", overview);
      values[0].textContent = money(data.revenue); values[1].textContent = data.invoiceCount.toLocaleString("vi-VN");
      values[2].textContent = data.customerCount.toLocaleString("vi-VN"); values[3].textContent = money(data.pendingAmount);
      const metricNotes = ["Đã thanh toán trong 30 ngày", "Tổng hóa đơn trong cơ sở dữ liệu", "Tài khoản khách hàng", "Hóa đơn chờ thanh toán"];
      $$(".metric-card", overview).forEach((card, index) => { card.querySelector(".metric-foot").textContent = metricNotes[index]; card.querySelector(".sparkline").hidden = true; });
      const report = await request("/reports");
      const monthlyValues = Array.from({ length: 12 }, (_, index) => report.monthly.find(item => item.month === index + 1 && item.year === new Date().getFullYear())?.revenue || 0);
      const maxRevenue = Math.max(...monthlyValues, 1);
      const points = monthlyValues.map((value, index) => `${(index * 700 / 11).toFixed(1)} ${(190 - value / maxRevenue * 160).toFixed(1)}`);
      const linePath = `M${points.join(" L")}`;
      $$(".y-axis span").forEach((label, index) => { const fraction = 1 - index / 4; label.textContent = fraction === 0 ? "₫0" : `₫${Math.round(maxRevenue * fraction / 1_000_000).toLocaleString("vi-VN")}tr`; });
      $(".current-line").setAttribute("d", linePath);
      $(".current-fill").setAttribute("d", `${linePath} L700 220 L0 220 Z`);
      $(".previous-line").setAttribute("d", "");
      $(".chart-point").setAttribute("cx", "700"); $(".chart-point").setAttribute("cy", String(190 - monthlyValues[11] / maxRevenue * 160));
      const total = data.paid + data.pending + data.overdue || 1;
      const paidPct = data.paid / total * 100; const pendingPct = data.pending / total * 100;
      $(".donut").style.background = `conic-gradient(#7568db 0 ${paidPct}%,#f1b46f ${paidPct}% ${paidPct + pendingPct}%,#ed8290 ${paidPct + pendingPct}% 100%)`;
      $(".donut-center strong").textContent = data.invoiceCount.toLocaleString("vi-VN");
      const statuses = $$(".status-legend > div");
      [[data.paid, paidPct], [data.pending, pendingPct], [data.overdue, data.overdue / total * 100]].forEach(([count, pct], index) => { statuses[index].querySelector("strong").innerHTML = `${count} <small>${pct.toFixed(1)}%</small>`; });
      const tbody = $(".invoices-panel tbody");
      tbody.innerHTML = data.recentInvoices.length ? data.recentInvoices.map((invoice) => `<tr><td><span class="invoice-id">#${esc(invoice.code)}</span></td><td><span class="customer-cell">${esc(invoice.customerName)}</span></td><td>${date(invoice.createdAt)}</td><td class="amount">${money(invoice.amount)}</td><td><span class="status-badge ${invoice.status === "Paid" ? "status-paid" : invoice.status === "Overdue" ? "status-overdue" : "status-pending"}"><i></i>${statusLabel(invoice.status)}</span></td><td></td></tr>`).join("") : `<tr><td colspan="6">Chưa có hóa đơn. Hãy vào Quản lý hóa đơn để tạo mới.</td></tr>`;
      $(".table-footer > span").innerHTML = `Hiển thị <strong>${data.recentInvoices.length}</strong> trong <strong>${data.invoiceCount}</strong> hóa đơn`;
      $(".nav-count").textContent = data.invoiceCount.toLocaleString("vi-VN");
      $(".pagination").hidden = true;
      $(".demo-notice").hidden = true; $(".page-bottom span:last-child").textContent = "Dữ liệu trực tiếp từ cơ sở dữ liệu";
    } catch (error) { showError(error); }
  }
  function renderNotifications(data) {
    const list = $("#notification-list"); const summary = $("#notification-summary"); const count = $("#notification-count"); const dot = $("#notification-dot");
    if (!list || !summary || !count || !dot) return;
    const pending = Number(data.pending) || 0; const overdue = Number(data.overdue) || 0; const total = pending + overdue;
    const alerts = (data.recentInvoices || []).filter(invoice => invoice.status === "Overdue" || invoice.status === "Pending").slice(0, 5);
    const signature = `${pending}:${overdue}:${alerts.map(invoice => `${invoice.id}:${invoice.status}`).join(",")}`;
    const storageKey = "invoiceflow.admin.notifications.read";
    let isRead = false;
    try { isRead = localStorage.getItem(storageKey) === signature; } catch { /* Notifications still work when storage is unavailable. */ }
    summary.textContent = `${pending} hóa đơn chờ thanh toán · ${overdue} hóa đơn quá hạn`;
    count.textContent = total > 99 ? "99+" : String(total); count.hidden = total === 0 || isRead; dot.hidden = total === 0 || isRead;
    list.innerHTML = alerts.length ? alerts.map(invoice => `<article class="notification-item"><span class="notification-status ${invoice.status === "Overdue" ? "is-overdue" : "is-pending"}"></span><div><strong>${invoice.status === "Overdue" ? "Hóa đơn quá hạn" : "Hóa đơn chờ thanh toán"}</strong><p>${esc(invoice.code)} · ${esc(invoice.customerName)}</p><small>${money(invoice.amount)} · ${date(invoice.createdAt)}</small></div></article>`).join("") : `<p class="notification-empty">Hiện không có hóa đơn cần chú ý.</p>`;
    $("#notifications-mark-read").onclick = () => { try { localStorage.setItem(storageKey, signature); } catch { /* The panel can still be dismissed for this view. */ } count.hidden = true; dot.hidden = true; };
  }
  function $$(selector, root = document) { return [...root.querySelectorAll(selector)]; }
  function statusLabel(status) { return ({ Paid: "Đã thanh toán", Pending: "Chờ thanh toán", Overdue: "Quá hạn", Cancelled: "Đã hủy" })[status] || status; }
  function layout(title, description, actions = "") {
    heading.textContent = title; $(".breadcrumb strong").textContent = title; $(".heading-subtitle").textContent = description;
    overview.hidden = true; moduleView.hidden = false;
    moduleView.innerHTML = `<div class="module-toolbar">${actions}</div><div id="module-body"><p class="module-loading">Đang tải dữ liệu…</p></div>`;
  }
  async function openModule(key) {
    currentModule = key;
    if (key === "overview") { heading.textContent = "Tổng quan"; $(".breadcrumb strong").textContent = "Tổng quan"; $(".heading-subtitle").innerHTML = `Chào mừng trở lại, <strong id="welcome-name">${esc(username)}</strong>. Đây là tình hình hoạt động hôm nay.`; moduleView.hidden = true; overview.hidden = false; await loadOverview(); return; }
    if (key === "accounts") return loadAccounts();
    if (key === "account-create") return loadAccountCreate();
    if (key === "invoice-create") return loadInvoiceForm();
    if (key === "permissions") return loadRoles();
    if (key === "invoices") return loadInvoices();
    if (key === "reports") return loadReports();
    if (key === "inventory") return loadInventory();
    if (key === "inventory-create") return loadInventoryForm();
    layout("Cài đặt", "Thiết lập chung cho không gian quản trị."); $("#module-body").innerHTML = `<section class="panel module-placeholder"><h2>Cài đặt hệ thống</h2><p>Cấu hình kết nối và tùy chọn chung hiện được quản lý trong cấu hình backend.</p></section>`;
  }
  async function loadAccounts() {
    layout("Quản lý tài khoản", "Tạo tài khoản, thay đổi vai trò và trạng thái truy cập.", `<div class="account-list-actions"><button class="secondary-button" id="refresh-accounts" type="button">Làm mới</button><button class="primary-button" id="create-account" type="button">+ Tạo tài khoản</button></div>`);
    try { const [users, roles] = await Promise.all([request("/accounts"), request("/roles")]); const roleOptions = roles.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join("");
      $("#module-body").innerHTML = `<section class="panel data-panel"><div class="table-scroll"><table><thead><tr><th>TÀI KHOẢN</th><th>EMAIL</th><th>ĐIỆN THOẠI</th><th>VAI TRÒ</th><th>TRẠNG THÁI</th><th>NGÀY TẠO</th><th></th></tr></thead><tbody>${users.map(u => `<tr data-id="${u.id}"><td class="invoice-id">${esc(u.username)}</td><td>${esc(u.email)}</td><td>${esc(u.phone || "—")}</td><td><select class="inline-select account-role">${roles.map(r => `<option ${u.role === r.name ? "selected" : ""} value="${esc(r.name)}">${esc(r.name)}</option>`).join("")}</select></td><td><button class="status-toggle ${u.isActive ? "enabled" : "disabled"}" data-active="${u.isActive}" type="button">${u.isActive ? "Đang hoạt động" : "Đã khóa"}</button></td><td>${date(u.createdAt)}</td><td><button class="text-action delete-account" type="button">Xóa</button></td></tr>`).join("") || `<tr><td colspan="7">Chưa có tài khoản.</td></tr>`}</tbody></table></div></section>`;
      $("#create-account").onclick = () => loadAccountCreate();
      $("#refresh-accounts").onclick = () => loadAccounts();
      $$(".account-role").forEach(select => select.onchange = async () => { try { await request(`/accounts/${select.closest("tr").dataset.id}`, { method: "PATCH", body: JSON.stringify({ role: select.value }) }); } catch (e) { alert(e.message); } });
      $$(".status-toggle").forEach(button => button.onclick = async () => { try { await request(`/accounts/${button.closest("tr").dataset.id}`, { method: "PATCH", body: JSON.stringify({ isActive: button.dataset.active !== "true" }) }); await loadAccounts(); } catch (e) { alert(e.message); } });
      $$(".delete-account").forEach(button => button.onclick = async () => { if (!confirm("Xóa tài khoản này?")) return; try { await request(`/accounts/${button.closest("tr").dataset.id}`, { method: "DELETE" }); await loadAccounts(); } catch (e) { alert(e.message); } });
    } catch (e) { showError(e); }
  }
  async function loadAccountCreate() {
    layout("Thêm tài khoản", "Nhập thông tin đăng nhập và vai trò cho tài khoản mới.");
    try {
      const roles = (await request("/roles")).filter(role => role.name !== "Admin");
      if (!roles.length) throw new Error("Chưa có vai trò phù hợp để tạo tài khoản.");
      $("#module-body").innerHTML = `<section class="panel account-form-panel"><div class="account-form-intro"><span class="account-form-icon" aria-hidden="true">＋</span><div><h2>Thông tin tài khoản</h2><p>Các trường có dấu * là bắt buộc.</p></div></div><form id="account-create-form" class="account-form"><div class="account-form-grid"><label class="account-field"><span>Tên đăng nhập <b>*</b></span><input name="username" type="text" autocomplete="username" maxlength="100" placeholder="Ví dụ: nguyenvana" required></label><label class="account-field"><span>Email <b>*</b></span><input name="email" type="email" autocomplete="email" maxlength="254" placeholder="name@example.com" required></label><label class="account-field"><span>Mật khẩu <b>*</b></span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Tối thiểu 8 ký tự" required><small>Mật khẩu cần có ít nhất 8 ký tự.</small></label><label class="account-field"><span>Vai trò <b>*</b></span><select name="role" required>${roles.map(role => `<option value="${esc(role.name)}" ${role.name === "Staff" ? "selected" : ""}>${esc(role.name)}</option>`).join("")}</select><small>Để đăng nhập vào khu vực nhân viên, hãy chọn vai trò Staff.</small></label></div><p class="account-form-message" id="account-form-message" role="status" aria-live="polite"></p><div class="account-form-actions"><button class="secondary-button" id="cancel-account-create" type="button">Quay lại danh sách</button><button class="primary-button" type="submit">Tạo tài khoản</button></div></form></section>`;
      $("#cancel-account-create").onclick = () => loadAccounts();
      $("#account-create-form").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget; const submit = form.querySelector('button[type="submit"]'); const message = $("#account-form-message");
        const values = Object.fromEntries(new FormData(form).entries()); submit.disabled = true; message.textContent = "Đang tạo tài khoản…"; message.classList.remove("is-error");
        try { await request("/accounts", { method: "POST", body: JSON.stringify(values) }); await loadAccounts(); }
        catch (error) { message.textContent = error.message; message.classList.add("is-error"); submit.disabled = false; }
      });
    } catch (error) { showError(error); }
  }
  async function loadRoles() {
    layout("Phân quyền người dùng", "Chọn các nhóm chức năng được phép truy cập cho từng vai trò.");
    try { const roles = await request("/roles"); const permissions = [["accounts", "Quản lý tài khoản"], ["permissions", "Phân quyền"], ["invoices", "Quản lý hóa đơn"], ["reports", "Báo cáo, thống kê"], ["inventory", "Tồn kho"]];
      $("#module-body").innerHTML = `<div class="role-grid">${roles.map(role => `<section class="panel role-card" data-role="${esc(role.name)}"><h2>${esc(role.name)}</h2><p>Quyền chức năng</p>${permissions.map(([key, label]) => `<label><input type="checkbox" value="${key}" ${role.permissions.includes(key) ? "checked" : ""}> ${label}</label>`).join("")}<button class="primary-button save-role" type="button">Lưu quyền</button></section>`).join("")}</div>`;
      $$(".save-role").forEach(button => button.onclick = async () => { const card = button.closest(".role-card"); const selected = $$("input:checked", card).map(input => input.value); try { await request(`/roles/${encodeURIComponent(card.dataset.role)}`, { method: "PUT", body: JSON.stringify({ permissions: selected }) }); alert("Đã lưu phân quyền."); } catch (e) { alert(e.message); } });
    } catch (e) { showError(e); }
  }
  function loadInvoiceForm(existing = null) {
    const editing = Boolean(existing);
    layout(editing ? "Sửa hóa đơn" : "Tạo hóa đơn", editing ? "Cập nhật khách hàng và số tiền của hóa đơn." : "Nhập thông tin để lập hóa đơn mới.");
    const value = key => esc(existing?.[key] ?? "");
    $("#module-body").innerHTML = `<section class="panel account-form-panel"><div class="account-form-intro"><span class="account-form-icon" aria-hidden="true">▤</span><div><h2>${editing ? "Thông tin hóa đơn" : "Thông tin hóa đơn mới"}</h2><p>${editing ? `Mã hóa đơn: ${esc(existing.code)}` : "Mã hóa đơn sẽ được tạo tự động sau khi lưu."}</p></div></div><form id="invoice-form" class="account-form"><div class="account-form-grid"><label class="account-field"><span>Tên khách hàng <b>*</b></span><input name="customerName" type="text" maxlength="200" value="${value("customerName")}" placeholder="Nhập tên khách hàng" autocomplete="off" required></label><label class="account-field"><span>Số tiền (₫) <b>*</b></span><input name="amount" type="number" min="0.01" step="0.01" value="${value("amount")}" placeholder="Ví dụ: 1250000" required><small>Số tiền phải lớn hơn 0; tối đa hai chữ số thập phân.</small></label></div><div class="invoice-form-note"><strong>${editing ? "Trạng thái hiện tại" : "Trạng thái ban đầu"}</strong><span class="status-badge ${existing?.status === "Paid" ? "status-paid" : existing?.status === "Overdue" ? "status-overdue" : existing?.status === "Cancelled" ? "status-cancelled" : "status-pending"}"><i></i>${editing ? statusLabel(existing.status) : "Chờ thanh toán"}</span>${editing ? "" : `<small>Hóa đơn mới sẽ được tạo ở trạng thái chờ thanh toán.</small>`}</div><p class="account-form-message" id="invoice-form-message" role="status" aria-live="polite"></p><div class="account-form-actions"><button class="secondary-button" id="cancel-invoice-form" type="button">Quay lại danh sách</button><button class="primary-button" type="submit">${editing ? "Lưu thay đổi" : "Tạo hóa đơn"}</button></div></form></section>`;
    $("#cancel-invoice-form").onclick = () => loadInvoices();
    $("#invoice-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget; const submit = form.querySelector('button[type="submit"]'); const message = $("#invoice-form-message");
      const values = Object.fromEntries(new FormData(form).entries()); values.customerName = values.customerName.trim(); values.amount = Number(values.amount);
      if (!values.customerName || !Number.isFinite(values.amount) || values.amount <= 0) { message.textContent = "Vui lòng nhập tên khách hàng và số tiền hợp lệ."; message.classList.add("is-error"); return; }
      submit.disabled = true; message.textContent = editing ? "Đang lưu thay đổi…" : "Đang tạo hóa đơn…"; message.classList.remove("is-error");
      try { await request(editing ? `/invoices/${existing.id}` : "/invoices", { method: editing ? "PATCH" : "POST", body: JSON.stringify(values) }); await loadInvoices(); }
      catch (error) { message.textContent = error.message; message.classList.add("is-error"); submit.disabled = false; }
    });
  }
  async function loadInvoices() {
    layout("Quản lý hóa đơn", "Tạo hóa đơn và cập nhật trạng thái thanh toán.", `<button class="primary-button" id="create-invoice" type="button">+ Tạo hóa đơn</button>`);
    try { const invoices = await request("/invoices");
      $("#module-body").innerHTML = `<section class="panel data-panel"><div class="table-scroll"><table><thead><tr><th>MÃ HÓA ĐƠN</th><th>KHÁCH HÀNG</th><th>NGÀY TẠO</th><th>SỐ TIỀN</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>${invoices.map(i => `<tr data-id="${i.id}"><td class="invoice-id">${esc(i.code)}</td><td class="invoice-customer">${esc(i.customerName)}</td><td>${date(i.createdAt)}</td><td class="amount invoice-amount" data-amount="${i.amount}">${money(i.amount)}</td><td><select class="inline-select invoice-status" data-id="${i.id}"><option value="Pending" ${i.status === "Pending" ? "selected" : ""}>Chờ thanh toán</option><option value="Paid" ${i.status === "Paid" ? "selected" : ""}>Đã thanh toán</option><option value="Overdue" ${i.status === "Overdue" ? "selected" : ""}>Quá hạn</option><option value="Cancelled" ${i.status === "Cancelled" ? "selected" : ""}>Đã hủy</option></select></td><td><button class="text-action edit-invoice" type="button">Sửa</button> <button class="text-action delete-invoice" type="button">Xóa</button></td></tr>`).join("") || `<tr><td colspan="6">Chưa có hóa đơn.</td></tr>`}</tbody></table></div></section>`;
      $("#create-invoice").onclick = () => loadInvoiceForm();
      $$(".invoice-status").forEach(select => select.onchange = async () => { try { await request(`/invoices/${select.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) }); } catch (e) { alert(e.message); } });
      $$(".edit-invoice").forEach(button => button.onclick = () => { const invoice = invoices.find(item => item.id === button.closest("tr").dataset.id); if (invoice) loadInvoiceForm(invoice); });
      $$(".delete-invoice").forEach(button => button.onclick = async () => { const row = button.closest("tr"); if (!confirm(`Xóa hóa đơn ${row.querySelector(".invoice-id").textContent}?`)) return; try { await request(`/invoices/${row.dataset.id}`, { method: "DELETE" }); await loadInvoices(); } catch (e) { alert(e.message); } });
    } catch (e) { showError(e); }
  }
  async function loadReports() {
    layout("Báo cáo, thống kê", "Số liệu tổng hợp từ các hóa đơn trong hệ thống.");
    try { const report = await request("/reports"); $("#module-body").innerHTML = `<div class="metrics-grid module-metrics"><article class="metric-card"><div class="metric-top">Tổng doanh thu đã thu</div><div class="metric-value">${money(report.totalRevenue)}</div></article><article class="metric-card"><div class="metric-top">Tổng hóa đơn</div><div class="metric-value">${report.invoiceCount.toLocaleString("vi-VN")}</div></article><article class="metric-card"><div class="metric-top">Đã thanh toán</div><div class="metric-value">${report.paidCount.toLocaleString("vi-VN")}</div></article><article class="metric-card"><div class="metric-top">Đang chờ thanh toán</div><div class="metric-value">${money(report.pendingAmount)}</div></article></div><section class="panel data-panel report-table"><h2>Doanh thu theo tháng</h2><div class="table-scroll"><table><thead><tr><th>THÁNG</th><th>SỐ HÓA ĐƠN ĐÃ THU</th><th>DOANH THU</th></tr></thead><tbody>${report.monthly.map(m => `<tr><td>${m.month}/${m.year}</td><td>${m.count}</td><td class="amount">${money(m.revenue)}</td></tr>`).join("") || `<tr><td colspan="3">Chưa có dữ liệu báo cáo.</td></tr>`}</tbody></table></div></section>`; } catch (e) { showError(e); }
  }
  async function loadInventory() {
    layout("Xem tồn kho", "Theo dõi số lượng, giá trị và mức tồn tối thiểu.", `<button class="primary-button" id="create-item" type="button">+ Thêm mặt hàng</button>`);
    try { const items = await request("/inventory"); const low = items.filter(i => i.quantity <= i.reorderLevel).length;
      $("#module-body").innerHTML = `<div class="metrics-grid module-metrics"><article class="metric-card"><div class="metric-top">Mặt hàng</div><div class="metric-value">${items.length}</div></article><article class="metric-card"><div class="metric-top">Sắp hết hàng</div><div class="metric-value">${low}</div></article><article class="metric-card"><div class="metric-top">Tổng số lượng tồn</div><div class="metric-value">${items.reduce((sum, i) => sum + i.quantity, 0).toLocaleString("vi-VN")}</div></article></div><section class="panel data-panel report-table"><div class="table-scroll"><table><thead><tr><th>MÃ SKU</th><th>MẶT HÀNG</th><th>SỐ LƯỢNG</th><th>MỨC TỐI THIỂU</th><th>ĐƠN GIÁ</th><th></th></tr></thead><tbody>${items.map(i => `<tr data-id="${i.id}"><td class="invoice-id">${esc(i.sku)}</td><td>${esc(i.name)}</td><td>${i.quantity} ${i.quantity <= i.reorderLevel ? `<span class="stock-warning">Sắp hết</span>` : ""}</td><td>${i.reorderLevel}</td><td class="amount">${money(i.unitPrice)}</td><td><button class="text-action edit-item" type="button">Sửa</button> <button class="text-action delete-item" type="button">Xóa</button></td></tr>`).join("") || `<tr><td colspan="6">Chưa có mặt hàng.</td></tr>`}</tbody></table></div></section>`;
      $("#create-item").onclick = () => loadInventoryForm();
      $$(".edit-item").forEach(button => button.onclick = () => { const item = items.find(i => i.id === button.closest("tr").dataset.id); if (item) loadInventoryForm(item); });
      $$(".delete-item").forEach(button => button.onclick = async () => { if (!confirm("Xóa mặt hàng này?")) return; try { await request(`/inventory/${button.closest("tr").dataset.id}`, { method: "DELETE" }); await loadInventory(); } catch (e) { alert(e.message); } });
    } catch (e) { showError(e); }
  }
  function loadInventoryForm(existing = null) {
    const editing = Boolean(existing);
    layout(editing ? "Sửa mặt hàng" : "Thêm mặt hàng", editing ? "Cập nhật thông tin mặt hàng trong kho." : "Nhập thông tin mặt hàng mới vào kho.");
    const value = key => esc(existing?.[key] ?? "");
    $("#module-body").innerHTML = `<section class="panel account-form-panel"><div class="account-form-intro"><span class="account-form-icon" aria-hidden="true">▦</span><div><h2>${editing ? "Thông tin mặt hàng" : "Thông tin mặt hàng mới"}</h2><p>Cập nhật đúng mã SKU, số lượng và đơn giá để theo dõi tồn kho.</p></div></div><form id="inventory-form" class="account-form"><div class="account-form-grid"><label class="account-field"><span>Mã SKU <b>*</b></span><input name="sku" type="text" maxlength="80" value="${value("sku")}" placeholder="Ví dụ: SKU-001" autocomplete="off" required></label><label class="account-field"><span>Tên mặt hàng <b>*</b></span><input name="name" type="text" maxlength="200" value="${value("name")}" placeholder="Nhập tên mặt hàng" required></label><label class="account-field"><span>Số lượng hiện có <b>*</b></span><input name="quantity" type="number" min="0" step="1" value="${value("quantity")}" placeholder="0" required><small>Nhập số nguyên từ 0 trở lên.</small></label><label class="account-field"><span>Mức tồn tối thiểu <b>*</b></span><input name="reorderLevel" type="number" min="0" step="1" value="${value("reorderLevel")}" placeholder="5" required><small>Cảnh báo khi số lượng bằng hoặc thấp hơn mức này.</small></label><label class="account-field"><span>Đơn giá (₫) <b>*</b></span><input name="unitPrice" type="number" min="0" step="0.01" value="${value("unitPrice")}" placeholder="0" required><small>Cho phép nhập số lẻ đến hai chữ số thập phân.</small></label></div><p class="account-form-message" id="inventory-form-message" role="status" aria-live="polite"></p><div class="account-form-actions"><button class="secondary-button" id="cancel-inventory-form" type="button">Quay lại tồn kho</button><button class="primary-button" type="submit">${editing ? "Lưu thay đổi" : "Thêm mặt hàng"}</button></div></form></section>`;
    $("#cancel-inventory-form").onclick = () => loadInventory();
    $("#inventory-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget; const submit = form.querySelector('button[type="submit"]'); const message = $("#inventory-form-message");
      const values = Object.fromEntries(new FormData(form).entries());
      values.sku = values.sku.trim(); values.name = values.name.trim(); values.quantity = Number(values.quantity); values.reorderLevel = Number(values.reorderLevel); values.unitPrice = Number(values.unitPrice);
      if (!values.sku || !values.name || !Number.isInteger(values.quantity) || values.quantity < 0 || !Number.isInteger(values.reorderLevel) || values.reorderLevel < 0 || !Number.isFinite(values.unitPrice) || values.unitPrice < 0) { message.textContent = "Vui lòng kiểm tra lại thông tin mặt hàng."; message.classList.add("is-error"); return; }
      submit.disabled = true; message.textContent = editing ? "Đang lưu thay đổi…" : "Đang thêm mặt hàng…"; message.classList.remove("is-error");
      try { await request(editing ? `/inventory/${existing.id}` : "/inventory", { method: editing ? "PUT" : "POST", body: JSON.stringify(values) }); await loadInventory(); }
      catch (error) { message.textContent = error.message; message.classList.add("is-error"); submit.disabled = false; }
    });
  }

  $("#admin-logout").addEventListener("click", async () => { try { await fetch(`${api}/api/v1/auth/admin/logout`, { method: "POST", credentials: "include" }); } finally { window.location.replace("../index.html"); } });
  const profileToggle = $("#profile-menu-toggle"); const profileMenu = $("#profile-menu");
  const notificationToggle = $("#notification-toggle"); const notificationMenu = $("#notification-menu");
  window.addEventListener("storage", event => { if (event.key === "invoiceflow.accounts.updated" && currentModule === "accounts") loadAccounts(); });
  notificationToggle.addEventListener("click", () => { const isOpen = notificationToggle.getAttribute("aria-expanded") === "true"; notificationToggle.setAttribute("aria-expanded", String(!isOpen)); notificationMenu.hidden = isOpen; });
  $("#view-notifications-invoices").addEventListener("click", () => {
    notificationToggle.setAttribute("aria-expanded", "false"); notificationMenu.hidden = true;
    document.querySelectorAll(".main-nav a").forEach(item => { item.classList.remove("active"); item.removeAttribute("aria-current"); });
    const invoicesLink = $(`.main-nav a[href="#invoices"]`); invoicesLink?.classList.add("active"); invoicesLink?.setAttribute("aria-current", "page");
    openModule("invoices");
  });
  profileToggle.addEventListener("click", () => { const isOpen = profileToggle.getAttribute("aria-expanded") === "true"; profileToggle.setAttribute("aria-expanded", String(!isOpen)); profileMenu.hidden = isOpen; });
  document.addEventListener("click", event => { if (!event.target.closest(".profile-menu-wrap")) { profileToggle.setAttribute("aria-expanded", "false"); profileMenu.hidden = true; } if (!event.target.closest(".notification-menu-wrap")) { notificationToggle.setAttribute("aria-expanded", "false"); notificationMenu.hidden = true; } });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { profileToggle.setAttribute("aria-expanded", "false"); profileMenu.hidden = true; notificationToggle.setAttribute("aria-expanded", "false"); notificationMenu.hidden = true; } });
  $("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  document.querySelectorAll(".main-nav a, .settings-link").forEach(link => link.addEventListener("click", event => {
    event.preventDefault(); document.querySelectorAll(".main-nav a").forEach(item => { item.classList.remove("active"); item.removeAttribute("aria-current"); });
    if (link.closest(".main-nav")) { link.classList.add("active"); link.setAttribute("aria-current", "page"); }
    openModule(link.getAttribute("href").slice(1)); $("#sidebar").classList.remove("open"); profileToggle.setAttribute("aria-expanded", "false"); profileMenu.hidden = true;
  }));
});
