document.addEventListener("DOMContentLoaded", async () => {
  const api = window.APP_CONFIG?.apiBaseUrl ?? `http://${window.location.hostname}:5000`;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const moduleView = $("#staff-module-view"); const overview = $("#staff-overview");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const money = value => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(Number(value) || 0);
  const date = value => new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
  let currentModule = "overview"; let staffName = "Nhân viên";
  const request = async (path, options = {}) => {
    const response = await fetch(`${api}/api/v1/staff${path}`, { credentials: "include", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || `Yêu cầu thất bại (${response.status})`); }
    return response.status === 204 ? null : response.json();
  };
  const showError = error => { moduleView.hidden = false; overview.hidden = true; moduleView.innerHTML = `<section class="panel module-placeholder"><h2>Không thể tải dữ liệu</h2><p>${esc(error.message)}</p><button class="primary-button" id="staff-retry" type="button">Thử lại</button></section>`; $("#staff-retry").onclick = () => openModule(currentModule); };
  const statusText = status => ({ Pending: "Chờ thanh toán", Paid: "Đã thanh toán", Overdue: "Quá hạn", Cancelled: "Đã hủy" })[status] || status;
  const statusClass = status => ({ Pending: "status-pending", Paid: "status-paid", Overdue: "status-overdue", Cancelled: "status-cancelled" })[status] || "status-pending";
  const invoiceRows = invoices => invoices.length ? invoices.map(invoice => `<tr data-id="${esc(invoice.id)}"><td><span class="invoice-id">${esc(invoice.code)}</span></td><td>${esc(invoice.customerName)}</td><td>${esc(invoice.itemName || "—")}</td><td>${date(invoice.createdAt)}</td><td class="amount">${money(invoice.amount)}</td><td><span class="status-badge ${statusClass(invoice.status)}"><i></i>${statusText(invoice.status)}</span></td><td class="staff-row-actions">${invoice.status !== "Paid" && invoice.status !== "Cancelled" ? `<button class="text-action staff-confirm-payment" type="button">Xác nhận đã thu</button>` : ""}${invoice.status !== "Paid" ? `<button class="text-action staff-edit-invoice" type="button">Sửa</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="7" class="staff-table-empty">Không tìm thấy hóa đơn phù hợp.</td></tr>`;

  try {
    const response = await fetch(`${api}/api/v1/auth/staff/session`, { credentials: "include" });
    if (response.status === 401 || response.status === 403) { window.location.replace("../index.html"); return; }
    if (!response.ok) throw new Error("Không xác thực được phiên nhân viên.");
    const session = await response.json(); staffName = session.username || staffName;
    $("#staff-dropdown-username").textContent = staffName; $("#staff-welcome-name").textContent = staffName;
    const initials = staffName.slice(0, 1).toLocaleUpperCase("vi"); $("#staff-top-avatar").textContent = initials;
    $("#staff-date").textContent = new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date());
    await loadOverview(); $("#staff-loading").hidden = true; $("#staff-content").hidden = false;
  } catch (error) { $("#staff-loading").textContent = `Không tải được khu vực nhân viên: ${error.message}`; return; }

  async function loadOverview() {
    try {
      const data = await request("/overview");
      $("#staff-metric-customers").textContent = Number(data.customerCount || 0).toLocaleString("vi-VN");
      $("#staff-metric-invoices").textContent = Number(data.invoiceCount || 0).toLocaleString("vi-VN");
      $("#staff-metric-pending").textContent = Number(data.pending || 0).toLocaleString("vi-VN");
      $("#staff-metric-paid").textContent = Number(data.paid || 0).toLocaleString("vi-VN");
      $("#staff-recent-invoices").innerHTML = invoiceRows(data.recentInvoices || []);
      wireInvoiceActions(data.recentInvoices || []);
    } catch (error) { showError(error); }
  }
  function layout(key, title, description, actions = "") {
    currentModule = key; $("#staff-page-title").textContent = title; $("#staff-page-description").textContent = description; $("#staff-breadcrumb").textContent = title;
    overview.hidden = true; moduleView.hidden = false; moduleView.innerHTML = `${actions ? `<div class="module-toolbar">${actions}</div>` : ""}<div id="staff-module-body"><p class="module-loading">Đang tải dữ liệu…</p></div>`;
  }
  async function openModule(key) {
    currentModule = key;
    if (key === "overview") { $("#staff-page-title").textContent = "Tổng quan"; $("#staff-page-description").textContent = "Theo dõi khách hàng và xử lý hóa đơn trong ngày."; $("#staff-breadcrumb").textContent = "Tổng quan"; moduleView.hidden = true; overview.hidden = false; await loadOverview(); return; }
    if (key === "customers") return loadCustomers();
    if (key === "invoices") return loadInvoices();
    if (key === "search") return loadInvoiceSearch();
    if (key === "support") return loadSupport();
  }
  function setActive(key) {
    $$("[data-staff-module]").forEach(link => { const active = link.dataset.staffModule === key; link.classList.toggle("active", active); if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
    $("#staff-sidebar").classList.remove("open");
  }
  async function loadCustomers(search = "") {
    layout("customers", "Quản lý khách hàng", "Tra cứu hồ sơ và thông tin liên hệ khách hàng.", `<form id="staff-customer-search" class="staff-search-form"><input name="search" type="search" value="${esc(search)}" placeholder="Tìm theo tên hoặc email" aria-label="Tìm khách hàng"><button class="primary-button" type="submit">Tìm kiếm</button></form>`);
    try {
      const customers = await request(`/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      $("#staff-module-body").innerHTML = `<section class="panel data-panel"><div class="table-scroll"><table><thead><tr><th>KHÁCH HÀNG</th><th>EMAIL</th><th>ĐIỆN THOẠI</th><th>TRẠNG THÁI</th><th>NGÀY TẠO</th><th>HỖ TRỢ</th></tr></thead><tbody>${customers.map(customer => `<tr><td class="invoice-id">${esc(customer.username)}</td><td>${esc(customer.email)}</td><td>${esc(customer.phone || "—")}</td><td><span class="staff-account-state ${customer.isActive ? "is-active" : "is-inactive"}">${customer.isActive ? "Đang hoạt động" : "Đã khóa"}</span></td><td>${date(customer.createdAt)}</td><td><a class="text-action" href="mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent("InvoiceFlow - Hỗ trợ khách hàng")}">Gửi email</a></td></tr>`).join("") || `<tr><td colspan="6" class="staff-table-empty">Chưa có khách hàng phù hợp.</td></tr>`}</tbody></table></div></section><p class="staff-result-count">${customers.length.toLocaleString("vi-VN")} khách hàng</p>`;
      $("#staff-customer-search").onsubmit = event => { event.preventDefault(); loadCustomers(new FormData(event.currentTarget).get("search").trim()); };
    } catch (error) { showError(error); }
  }
  async function loadInvoices(search = "", status = "") {
    layout("invoices", "Quản lý hóa đơn", "Tạo, cập nhật và xác nhận thanh toán hóa đơn.", `<div class="staff-invoice-toolbar"><form id="staff-invoice-filter" class="staff-search-form"><input name="search" type="search" value="${esc(search)}" placeholder="Mã hóa đơn hoặc khách hàng" aria-label="Tìm hóa đơn"><select name="status" aria-label="Lọc theo trạng thái"><option value="">Tất cả trạng thái</option><option value="Pending" ${status === "Pending" ? "selected" : ""}>Chờ thanh toán</option><option value="Paid" ${status === "Paid" ? "selected" : ""}>Đã thanh toán</option><option value="Overdue" ${status === "Overdue" ? "selected" : ""}>Quá hạn</option><option value="Cancelled" ${status === "Cancelled" ? "selected" : ""}>Đã hủy</option></select><button class="primary-button" type="submit">Lọc</button></form><button class="primary-button" id="staff-create-invoice" type="button">+ Tạo hóa đơn</button></div>`);
    try {
      const params = new URLSearchParams(); if (search) params.set("search", search); if (status) params.set("status", status);
      const invoices = await request(`/invoices${params.size ? `?${params}` : ""}`);
      $("#staff-module-body").innerHTML = `<section class="panel data-panel"><div class="table-scroll"><table><thead><tr><th>MÃ HÓA ĐƠN</th><th>KHÁCH HÀNG</th><th>MẶT HÀNG</th><th>NGÀY TẠO</th><th>SỐ TIỀN</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>${invoiceRows(invoices)}</tbody></table></div></section><p class="staff-result-count">${invoices.length.toLocaleString("vi-VN")} hóa đơn</p>`;
      $("#staff-invoice-filter").onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); loadInvoices(data.get("search").trim(), data.get("status")); };
      $("#staff-create-invoice").onclick = () => loadInvoiceForm(); wireInvoiceActions(invoices);
    } catch (error) { showError(error); }
  }
  async function loadInvoiceSearch(search = "", status = "") {
    layout("search", "Tra cứu hóa đơn", "Tìm nhanh hóa đơn theo mã, khách hàng hoặc trạng thái.", `<form id="staff-search-invoice-form" class="staff-search-page-form"><label for="staff-invoice-query">Mã hóa đơn hoặc tên khách hàng</label><div><input id="staff-invoice-query" name="search" type="search" value="${esc(search)}" placeholder="Ví dụ: INV-2026 ou Nguyen Van A"><select name="status" aria-label="Trạng thái"><option value="">Tất cả trạng thái</option><option value="Pending" ${status === "Pending" ? "selected" : ""}>Chờ thanh toán</option><option value="Paid" ${status === "Paid" ? "selected" : ""}>Đã thanh toán</option><option value="Overdue" ${status === "Overdue" ? "selected" : ""}>Quá hạn</option><option value="Cancelled" ${status === "Cancelled" ? "selected" : ""}>Đã hủy</option></select><button class="primary-button" type="submit">Tra cứu</button></div></form>`);
    $("#staff-module-body").innerHTML = search || status ? `<p class="module-loading">Đang tra cứu…</p>` : `<section class="panel staff-search-hint"><span class="staff-search-icon">⌕</span><h2>Nhập thông tin hóa đơn</h2><p>Có thể tìm bằng mã hóa đơn hoặc tên khách hàng.</p></section>`;
    $("#staff-search-invoice-form").onsubmit = async event => { event.preventDefault(); const data = new FormData(event.currentTarget); const query = data.get("search").trim(); const state = data.get("status"); await loadInvoiceSearchResults(query, state); };
    if (search || status) await loadInvoiceSearchResults(search, status);
  }
  async function loadInvoiceSearchResults(search, status) {
    try {
      const params = new URLSearchParams(); if (search) params.set("search", search); if (status) params.set("status", status);
      const invoices = await request(`/invoices${params.size ? `?${params}` : ""}`);
      const body = $("#staff-module-body"); if (!body) return;
      body.innerHTML = `<section class="panel data-panel"><div class="staff-search-results-heading"><h2>Kết quả tra cứu</h2><span>${invoices.length} hóa đơn</span></div><div class="table-scroll"><table><thead><tr><th>MÃ HÓA ĐƠN</th><th>KHÁCH HÀNG</th><th>MẶT HÀNG</th><th>NGÀY TẠO</th><th>SỐ TIỀN</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>${invoiceRows(invoices)}</tbody></table></div></section>`; wireInvoiceActions(invoices);
    } catch (error) { showError(error); }
  }
  async function loadSupport(search = "") {
    layout("support", "Hỗ trợ khách hàng", "Tìm khách hàng và liên hệ trực tiếp để hỗ trợ.", `<form id="staff-support-search" class="staff-search-form"><input name="search" type="search" value="${esc(search)}" placeholder="Tìm tên hoặc email khách hàng" aria-label="Tìm khách hàng cần hỗ trợ"><button class="primary-button" type="submit">Tìm khách hàng</button></form>`);
    try {
      const customers = await request(`/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      $("#staff-module-body").innerHTML = `<div class="staff-support-note"><span aria-hidden="true">i</span><p>Chọn <strong>Liên hệ hỗ trợ</strong> để mở ứng dụng email với tiêu đề hỗ trợ đã điền sẵn.</p></div><div class="staff-contact-grid">${customers.map(customer => `<article class="panel staff-contact-card"><span class="avatar">${esc(customer.username.slice(0, 1).toLocaleUpperCase("vi"))}</span><div><strong>${esc(customer.username)}</strong><small>${esc(customer.email)}</small>${customer.phone ? `<small>${esc(customer.phone)}</small>` : ""}</div><a class="primary-button" href="mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent("InvoiceFlow - Hỗ trợ khách hàng")}">Liên hệ hỗ trợ</a></article>`).join("") || `<section class="panel staff-search-hint"><h2>Không tìm thấy khách hàng</h2><p>Thử tìm bằng tên đăng nhập hoặc email khác.</p></section>`}</div>`;
      $("#staff-support-search").onsubmit = event => { event.preventDefault(); loadSupport(new FormData(event.currentTarget).get("search").trim()); };
    } catch (error) { showError(error); }
  }
  async function loadInvoiceForm(existing = null) {
    const editing = Boolean(existing); layout("invoices", editing ? "Sửa hóa đơn" : "Tạo hóa đơn", editing ? "Cập nhật thông tin hóa đơn." : "Lập hóa đơn cho khách hàng.");
    try {
      const [customerList, inventory] = await Promise.all([request("/customers"), request("/inventory")]); const customers = customerList.filter(customer => customer.isActive); const options = customers.map(customer => `<option value="${esc(customer.username)}">${esc(customer.email)}</option>`).join(""); const itemOptions = inventory.map(item => `<option value="${esc(item.name)}">${esc(item.sku)} · ${money(item.unitPrice)} · còn ${Number(item.quantity).toLocaleString("vi-VN")}</option>`).join("");
      $("#staff-module-body").innerHTML = `<section class="panel account-form-panel"><div class="account-form-intro"><span class="account-form-icon" aria-hidden="true">▤</span><div><h2>${editing ? "Thông tin hóa đơn" : "Thông tin hóa đơn mới"}</h2><p>${editing ? `Mã hóa đơn: ${esc(existing.code)}` : "Mã hóa đơn sẽ được tạo tự động."}</p></div></div><form id="staff-invoice-form" class="account-form"><div class="account-form-grid"><label class="account-field"><span>Tên khách hàng <b>*</b></span><input name="customerName" list="staff-customer-options" type="text" maxlength="200" value="${esc(existing?.customerName || "")}" placeholder="Nhập hoặc chọn khách hàng" required><datalist id="staff-customer-options">${options}</datalist></label><label class="account-field"><span>Tên mặt hàng${editing ? "" : " <b>*</b>"}</span><input name="itemName" list="staff-inventory-options" type="text" maxlength="200" value="${esc(existing?.itemName || "")}" placeholder="Chọn hoặc nhập tên mặt hàng" ${editing ? "" : "required"}><datalist id="staff-inventory-options">${itemOptions}</datalist><small>Có thể chọn mặt hàng đang có trong kho.</small></label><label class="account-field"><span>Số tiền (₫) <b>*</b></span><input name="amount" type="number" min="0.01" step="0.01" value="${editing ? esc(existing.amount) : ""}" placeholder="Ví dụ: 1250000" required><small>Hóa đơn mới được tạo với trạng thái chờ thanh toán.</small></label></div><p class="account-form-message" id="staff-invoice-form-message" role="status" aria-live="polite"></p><div class="account-form-actions"><button class="secondary-button" id="staff-cancel-invoice" type="button">Quay lại danh sách</button><button class="primary-button" type="submit">${editing ? "Lưu thay đổi" : "Tạo hóa đơn"}</button></div></form></section>`;
      $("#staff-cancel-invoice").onclick = () => loadInvoices();
      $("#staff-invoice-form").onsubmit = async event => {
        event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('button[type="submit"]'); const message = $("#staff-invoice-form-message"); const values = Object.fromEntries(new FormData(form).entries()); values.customerName = values.customerName.trim(); values.itemName = values.itemName.trim(); values.amount = Number(values.amount);
        if (!values.customerName || (!editing && !values.itemName) || !Number.isFinite(values.amount) || values.amount <= 0) { message.textContent = "Vui lòng nhập khách hàng, mặt hàng và số tiền hợp lệ."; message.classList.add("is-error"); return; }
        submit.disabled = true; message.textContent = editing ? "Đang lưu hóa đơn…" : "Đang tạo hóa đơn…"; message.classList.remove("is-error");
        try { await request(editing ? `/invoices/${existing.id}` : "/invoices", { method: editing ? "PATCH" : "POST", body: JSON.stringify(values) }); await loadInvoices(); }
        catch (error) { message.textContent = error.message; message.classList.add("is-error"); submit.disabled = false; }
      };
    } catch (error) { showError(error); }
  }
  function wireInvoiceActions(invoices) {
    $$(".staff-confirm-payment").forEach(button => button.onclick = async () => {
      const row = button.closest("tr"); const invoice = invoices.find(item => item.id === row.dataset.id); if (!invoice || !confirm(`Xác nhận đã nhận ${money(invoice.amount)} từ ${invoice.customerName}?`)) return;
      button.disabled = true; try { await request(`/invoices/${invoice.id}/confirm-payment`, { method: "POST" }); await openModule(currentModule); }
      catch (error) { alert(error.message); button.disabled = false; }
    });
    $$(".staff-edit-invoice").forEach(button => button.onclick = () => { const invoice = invoices.find(item => item.id === button.closest("tr").dataset.id); if (invoice) loadInvoiceForm(invoice); });
  }

  $$("[data-staff-module]").forEach(link => link.addEventListener("click", event => { event.preventDefault(); const key = link.dataset.staffModule; setActive(key); openModule(key); }));
  $$("[data-open-staff]").forEach(button => button.addEventListener("click", () => { const key = button.dataset.openStaff; setActive(key); openModule(key); }));
  $("#staff-mobile-menu").addEventListener("click", () => $("#staff-sidebar").classList.toggle("open"));
  const accountTrigger = $("#staff-account-trigger"); const accountDropdown = $("#staff-account-dropdown");
  accountTrigger.addEventListener("click", () => { const open = accountDropdown.hidden; accountDropdown.hidden = !open; accountTrigger.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("click", event => { if (!event.target.closest(".staff-account-menu")) { accountDropdown.hidden = true; accountTrigger.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", event => { if (event.key === "Escape") { accountDropdown.hidden = true; accountTrigger.setAttribute("aria-expanded", "false"); accountTrigger.focus(); } });
  $("#staff-logout").addEventListener("click", async () => { try { await fetch(`${api}/api/v1/auth/staff/logout`, { method: "POST", credentials: "include" }); } finally { window.location.replace("../index.html"); } });
});
