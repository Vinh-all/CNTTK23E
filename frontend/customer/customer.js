document.addEventListener("DOMContentLoaded", async () => {
  const api = window.APP_CONFIG?.apiBaseUrl ?? `http://${window.location.hostname}:5000`;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const money = value => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const date = value => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
  const statusText = status => ({ Pending: "Chờ thanh toán", Paid: "Đã thanh toán", Overdue: "Quá hạn", Cancelled: "Đã hủy" })[status] || status;
  const statusClass = status => ({ Pending: "status-pending", Paid: "status-paid", Overdue: "status-overdue", Cancelled: "status-cancelled" })[status] || "status-pending";
  const view = $("#customer-module-view"); const overview = $("#customer-overview");
  let currentModule = "overview"; let profile = null;
  let customerNotifications = [];
  const request = async (path, options = {}) => {
    const response = await fetch(`${api}/api/v1/customer${path}`, { credentials: "include", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || `Yêu cầu thất bại (${response.status})`); }
    return response.status === 204 ? null : response.json();
  };
  const showError = error => { view.hidden = false; overview.hidden = true; view.innerHTML = `<section class="panel module-placeholder"><h2>Không thể tải dữ liệu</h2><p>${esc(error.message)}</p><button class="primary-button" id="customer-retry" type="button">Thử lại</button></section>`; $("#customer-retry").onclick = () => openModule(currentModule); };
  const invoiceRows = invoices => invoices.length ? invoices.map(invoice => `<tr><td><span class="invoice-id">${esc(invoice.code)}</span></td><td>${esc(invoice.itemName || "—")}</td><td>${date(invoice.createdAt)}</td><td class="amount">${money(invoice.amount)}</td><td><span class="status-badge ${statusClass(invoice.status)}"><i></i>${statusText(invoice.status)}</span></td><td class="customer-row-actions">${["Pending", "Overdue"].includes(invoice.status) ? `<button type="button" data-pay-invoice="${esc(invoice.id)}">Thanh toán</button>` : "—"}</td></tr>`).join("") : `<tr><td colspan="6" class="customer-empty">Chưa có hóa đơn phù hợp.</td></tr>`;
  const loadInvoicesData = async (search = "", status = "") => {
    const params = new URLSearchParams(); if (search) params.set("search", search); if (status) params.set("status", status);
    return request(`/invoices${params.size ? `?${params}` : ""}`);
  };
  const bindPayButtons = invoices => $$('[data-pay-invoice]').forEach(button => button.onclick = async () => {
    const invoice = invoices.find(item => item.id === button.dataset.payInvoice); if (!invoice) return;
    if (!confirm(`Xác nhận thanh toán demo ${money(invoice.amount)} cho hóa đơn ${invoice.code}? Trạng thái sẽ được chuyển sang Đã thanh toán.`)) return;
    button.disabled = true;
    try { await request(`/invoices/${invoice.id}/pay`, { method: "POST" }); await openModule(currentModule); }
    catch (error) { alert(error.message); button.disabled = false; }
  });
  async function loadOverview() {
    try {
      const [invoices, notifications] = await Promise.all([loadInvoicesData(), request("/notifications")]);
      customerNotifications = notifications; renderNotificationMenu();
      const pending = invoices.filter(x => x.status === "Pending"); const paid = invoices.filter(x => x.status === "Paid");
      $("#customer-metric-total").textContent = invoices.length.toLocaleString("vi-VN");
      $("#customer-metric-pending").textContent = pending.length.toLocaleString("vi-VN");
      $("#customer-metric-paid").textContent = paid.length.toLocaleString("vi-VN");
      $("#customer-metric-amount").textContent = money(pending.reduce((sum, item) => sum + Number(item.amount), 0));
      $("#customer-recent-invoices").innerHTML = invoiceRows(invoices.slice(0, 6)); bindPayButtons(invoices);
      const latest = notifications[0];
      $("#customer-notice-latest").innerHTML = latest ? `<strong>${esc(latest.code)} · ${statusText(latest.status)}</strong><br>${esc(latest.message)} <span>${date(latest.createdAt)}</span>` : "Bạn chưa có thông báo hóa đơn.";
    } catch (error) { showError(error); }
  }
  function renderNotificationMenu() {
    const alerts = customerNotifications.filter(item => ["Pending", "Overdue"].includes(item.status));
    const count = $("#customer-notification-count"); const dot = $("#customer-notification-dot"); const list = $("#customer-notification-list");
    const signature = JSON.stringify(customerNotifications.map(item => `${item.id}:${item.status}`)); let readSignature = "";
    try { readSignature = localStorage.getItem("invoiceflow.customer.notifications.read") || ""; } catch { /* Notifications remain available if storage is disabled. */ }
    const unread = alerts.length && readSignature !== signature;
    count.hidden = !unread; dot.hidden = !unread; if (unread) count.textContent = alerts.length > 9 ? "9+" : String(alerts.length);
    $("#customer-notification-summary").textContent = alerts.length ? `${alerts.length} hóa đơn cần chú ý` : "Không có hóa đơn đang chờ xử lý";
    list.innerHTML = customerNotifications.length ? customerNotifications.slice(0, 5).map(item => `<article class="notification-item"><span class="notification-status ${item.status === "Overdue" ? "is-overdue" : item.status === "Paid" ? "is-paid" : "is-pending"}"></span><div><strong>${statusText(item.status)}</strong><p>${esc(item.code)}</p><small>${money(item.amount)} · ${date(item.createdAt)}</small></div></article>`).join("") : `<p class="notification-empty">Bạn chưa có thông báo hóa đơn.</p>`;
    $("#customer-notifications-mark-read").onclick = () => { try { localStorage.setItem("invoiceflow.customer.notifications.read", signature); } catch { /* The menu can still be cleared for this view. */ } count.hidden = true; dot.hidden = true; };
  }
  function layout(key, title, description, actions = "") {
    currentModule = key; $("#customer-page-title").textContent = title; $("#customer-page-description").textContent = description; $("#customer-breadcrumb").textContent = title;
    overview.hidden = true; view.hidden = false; view.innerHTML = `${actions ? `<div class="module-toolbar">${actions}</div>` : ""}<div id="customer-module-body"><p class="module-loading">Đang tải dữ liệu…</p></div>`;
  }
  function setActive(key) {
    $$('[data-customer-module]').forEach(link => { const active = link.dataset.customerModule === key; link.classList.toggle("active", active); if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
    $("#customer-sidebar").classList.remove("open");
  }
  async function openModule(key) {
    currentModule = key;
    if (key === "overview") { $("#customer-page-title").textContent = "Tổng quan"; $("#customer-page-description").textContent = "Theo dõi hóa đơn và cập nhật thông tin cá nhân."; $("#customer-breadcrumb").textContent = "Tổng quan"; view.hidden = true; overview.hidden = false; await loadOverview(); return; }
    if (key === "invoices") return loadInvoices();
    if (key === "items") return loadItems();
    if (key === "profile") return loadProfile();
    if (key === "notifications") return loadNotifications();
    if (key === "support") return loadSupport();
  }
  async function loadInvoices(search = "", status = "") {
    layout("invoices", "Hóa đơn của tôi", "Tra cứu hóa đơn và thanh toán các khoản đang chờ.", `<form id="customer-invoice-filter" class="customer-filters"><input name="search" type="search" value="${esc(search)}" placeholder="Tìm theo mã hóa đơn" aria-label="Tìm mã hóa đơn"><select name="status" aria-label="Lọc trạng thái"><option value="">Tất cả trạng thái</option><option value="Pending" ${status === "Pending" ? "selected" : ""}>Chờ thanh toán</option><option value="Paid" ${status === "Paid" ? "selected" : ""}>Đã thanh toán</option><option value="Overdue" ${status === "Overdue" ? "selected" : ""}>Quá hạn</option><option value="Cancelled" ${status === "Cancelled" ? "selected" : ""}>Đã hủy</option></select><button type="submit">Tra cứu</button></form>`);
    try {
      const invoices = await loadInvoicesData(search, status);
      $("#customer-module-body").innerHTML = `<section class="panel data-panel"><div class="table-scroll"><table><thead><tr><th>MÃ HÓA ĐƠN</th><th>MẶT HÀNG</th><th>NGÀY TẠO</th><th>SỐ TIỀN</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>${invoiceRows(invoices)}</tbody></table></div></section><p class="customer-result-count">${invoices.length.toLocaleString("vi-VN")} hóa đơn</p>`;
      $("#customer-invoice-filter").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); loadInvoices(data.get("search").trim(), data.get("status")); };
      bindPayButtons(invoices);
    } catch (error) { showError(error); }
  }
  async function loadItems(search = "") {
    layout("items", "Mặt hàng", "Xem các mặt hàng hiện có trong kho và đơn giá tham khảo.", `<form id="customer-item-search" class="customer-filters"><input name="search" type="search" value="${esc(search)}" placeholder="Tìm theo tên mặt hàng hoặc mã SKU" aria-label="Tìm mặt hàng"><button type="submit">Tìm mặt hàng</button></form>`);
    try {
      const items = await request(`/items${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      $("#customer-module-body").innerHTML = items.length ? `<div class="customer-item-grid">${items.map(item => `<article class="panel customer-item-card"><div class="customer-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg></div><span class="customer-item-sku">${esc(item.sku)}</span><h2>${esc(item.name)}</h2><div class="customer-item-price">${money(item.unitPrice)}</div><div class="customer-item-stock">Còn ${Number(item.quantity).toLocaleString("vi-VN")} sản phẩm</div></article>`).join("")}</div><p class="customer-result-count">${items.length.toLocaleString("vi-VN")} mặt hàng đang có hàng</p>` : `<section class="panel customer-item-empty"><h2>Không tìm thấy mặt hàng</h2><p>Hiện không có mặt hàng phù hợp hoặc còn hàng trong kho.</p></section>`;
      $("#customer-item-search").onsubmit = event => { event.preventDefault(); loadItems(new FormData(event.currentTarget).get("search").trim()); };
    } catch (error) { showError(error); }
  }
  async function loadProfile() {
    layout("profile", "Thông tin cá nhân", "Cập nhật tên hiển thị và thông tin liên hệ.");
    try {
      profile = await request("/profile");
      $("#customer-module-body").innerHTML = `<section class="panel customer-profile-panel"><h2>Thông tin tài khoản</h2><p>Khi thay đổi tên hiển thị, hóa đơn của bạn vẫn được giữ nguyên.</p><form id="customer-profile-form" class="customer-profile-form"><label>Tên hiển thị<input name="username" value="${esc(profile.username)}" minlength="2" maxlength="100" required></label><label>Email<input name="email" type="email" value="${esc(profile.email)}" maxlength="254" required></label><label>Số điện thoại<input name="phone" type="tel" value="${esc(profile.phone || "")}" maxlength="30"></label><p class="customer-form-message" id="customer-profile-message" role="status" aria-live="polite"></p><div class="customer-form-actions"><button type="submit">Lưu thay đổi</button></div></form></section>`;
      $("#customer-profile-form").onsubmit = async event => {
        event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('button[type="submit"]'); const message = $("#customer-profile-message"); const values = Object.fromEntries(new FormData(form).entries());
        submit.disabled = true; message.classList.remove("is-error"); message.textContent = "Đang lưu…";
        try { profile = await request("/profile", { method: "PATCH", body: JSON.stringify(values) }); syncProfile(); message.textContent = "Thông tin đã được cập nhật."; }
        catch (error) { message.textContent = error.message; message.classList.add("is-error"); }
        finally { submit.disabled = false; }
      };
    } catch (error) { showError(error); }
  }
  async function loadNotifications() {
    layout("notifications", "Thông báo", "Thông tin trạng thái mới nhất của hóa đơn của bạn.");
    try {
      const notifications = await request("/notifications");
      $("#customer-module-body").innerHTML = notifications.length ? `<div class="customer-notifications">${notifications.map(item => `<article class="customer-notification"><span class="customer-notification-dot ${statusClass(item.status)}"></span><div><strong>${esc(item.code)} · ${statusText(item.status)}</strong><p>${esc(item.message)} Số tiền: ${money(item.amount)}.</p><small>${date(item.createdAt)}</small></div></article>`).join("")}</div>` : `<section class="panel staff-search-hint"><h2>Chưa có thông báo</h2><p>Khi có hóa đơn, trạng thái sẽ xuất hiện tại đây.</p></section>`;
    } catch (error) { showError(error); }
  }
  function loadSupport() {
    layout("support", "Chăm sóc khách hàng", "Gửi câu hỏi hoặc yêu cầu hỗ trợ về tài khoản và hóa đơn.");
    $("#customer-module-body").innerHTML = `<section class="panel customer-support-panel"><h2>Chúng tôi có thể giúp gì cho bạn?</h2><p>Điền nội dung cần hỗ trợ. Nút gửi sẽ mở ứng dụng email trên thiết bị của bạn.</p><form id="customer-support-form" class="customer-support-form"><label>Chủ đề<input name="subject" maxlength="120" placeholder="Ví dụ: Cần hỗ trợ hóa đơn" required></label><label style="margin-top:14px">Nội dung<textarea name="body" maxlength="2000" placeholder="Mô tả vấn đề bạn gặp phải" required></textarea></label><p class="customer-form-message" id="customer-support-message" role="status" aria-live="polite">Email CSKH cần được cấu hình cho môi trường triển khai.</p><button type="submit">Soạn email CSKH</button></form></section>`;
    $("#customer-support-form").onsubmit = event => { event.preventDefault(); const email = window.APP_CONFIG?.supportEmail; const message = $("#customer-support-message"); if (!email) { message.textContent = "Email CSKH chưa được cấu hình. Vui lòng liên hệ quản trị hệ thống."; message.classList.add("is-error"); return; } const data = new FormData(event.currentTarget); const link = document.createElement("a"); link.href = `mailto:${email}?subject=${encodeURIComponent(data.get("subject"))}&body=${encodeURIComponent(data.get("body"))}`; link.click(); };
  }
  function syncProfile() {
    $("#customer-welcome-name").textContent = profile.username; $("#customer-menu-name").textContent = profile.username; $("#customer-avatar").textContent = profile.username.slice(0, 1).toLocaleUpperCase("vi");
  }
  try {
    const session = await fetch(`${api}/api/v1/auth/customer/session`, { credentials: "include" });
    if (session.status === 401 || session.status === 403) { window.location.replace("../index.html"); return; }
    if (!session.ok) throw new Error("Không xác thực được phiên khách hàng.");
    profile = await request("/profile"); syncProfile();
    $("#customer-date").textContent = new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date());
    await loadOverview(); $("#customer-loading").hidden = true; $("#customer-content").hidden = false;
  } catch (error) { $("#customer-loading").textContent = `Không tải được khu vực khách hàng: ${error.message}`; return; }

  $$('[data-customer-module]').forEach(link => link.addEventListener("click", event => { event.preventDefault(); const key = link.dataset.customerModule; setActive(key); openModule(key); }));
  $$('[data-open-customer]').forEach(button => button.addEventListener("click", () => { const key = button.dataset.openCustomer; dropdown.hidden = true; accountTrigger.setAttribute("aria-expanded", "false"); setActive(key); openModule(key); }));
  $("#customer-mobile-menu").addEventListener("click", () => $("#customer-sidebar").classList.toggle("open"));
  const accountTrigger = $("#customer-account-trigger"); const dropdown = $("#customer-account-dropdown");
  const notificationToggle = $("#customer-notification-toggle"); const notificationMenu = $("#customer-notification-menu");
  notificationToggle.addEventListener("click", () => { const isOpen = notificationToggle.getAttribute("aria-expanded") === "true"; notificationToggle.setAttribute("aria-expanded", String(!isOpen)); notificationMenu.hidden = isOpen; });
  $("#customer-view-all-notifications").addEventListener("click", () => { notificationToggle.setAttribute("aria-expanded", "false"); notificationMenu.hidden = true; openModule("notifications"); });
  accountTrigger.addEventListener("click", () => { dropdown.hidden = !dropdown.hidden; accountTrigger.setAttribute("aria-expanded", String(!dropdown.hidden)); });
  document.addEventListener("click", event => { if (!event.target.closest(".customer-account-menu")) { dropdown.hidden = true; accountTrigger.setAttribute("aria-expanded", "false"); } if (!event.target.closest(".notification-menu-wrap")) { notificationMenu.hidden = true; notificationToggle.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { dropdown.hidden = true; accountTrigger.setAttribute("aria-expanded", "false"); notificationMenu.hidden = true; notificationToggle.setAttribute("aria-expanded", "false"); accountTrigger.focus(); } });
  $("#customer-logout").addEventListener("click", async () => { try { await fetch(`${api}/api/v1/auth/customer/logout`, { method: "POST", credentials: "include" }); } finally { window.location.replace("../index.html"); } });
});
