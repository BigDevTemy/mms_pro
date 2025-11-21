;(function () {
  'use strict'

  // --- Component Classes ---

  // class CompanyComponent {
  //   constructor(container) {
  //     this.container = container
  //     this.companies = []
  //     this.searchQuery = ''
  //     this.init()
  //   }

  //   async init() {
  //     this.renderLayout()
  //     await this.loadCompanies()
  //     this.setupEventListeners()
  //   }

  //   renderLayout() {
  //     this.container.innerHTML = `
  //       <div class="company-header">
  //         <button class="btn btn-primary" id="addCompanyBtn">Add Company</button>
  //         <div class="search-container">
  //           <input type="text" id="searchCompanies" class="form-control" placeholder="Search companies...">
  //         </div>
  //       </div>
  //       <div class="table-responsive">
  //         <table id="companiesTable" class="table table-striped">
  //           <thead>
  //             <tr>
  //               <th>ID</th>
  //               <th>Name</th>
  //               <th>Created At</th>
  //             </tr>
  //           </thead>
  //           <tbody>
  //           </tbody>
  //         </table>
  //       </div>

  //       <div id="addCompanyModal" class="modal" style="display:none;">
  //         <div class="modal-content">
  //           <div class="modal-header">
  //             <h2>Add New Company</h2>
  //             <span class="close-btn" id="closeModalBtn">&times;</span>
  //           </div>
  //           <div class="modal-body">
  //             <form id="addCompanyForm">
  //               <div class="form-group">
  //                 <label for="companyName">Company Name</label>
  //                 <input type="text" id="companyName" name="name" class="form-control" required>
  //               </div>
  //               <button type="submit" class="btn btn-primary">Create Company</button>
  //             </form>
  //           </div>
  //         </div>
  //       </div>
  //     `
  //   }

  //   async loadCompanies() {
  //     try {
  //       const res = await getJson('/companies')
  //       this.companies = Array.isArray(res) ? res : res.items || []
  //       this.renderTable()
  //     } catch (error) {
  //       showToast(
  //         error && error.error ? error.error : 'Failed to load companies.',
  //         false
  //       )
  //     }
  //   }

  //   renderTable() {
  //     const tableBody = this.container.querySelector('#companiesTable tbody')
  //     const filteredCompanies = this.companies.filter((company) =>
  //       company.name.toLowerCase().includes(this.searchQuery.toLowerCase())
  //     )

  //     if (filteredCompanies.length === 0) {
  //       tableBody.innerHTML =
  //         '<tr><td colspan="3">No companies found.</td></tr>'
  //       return
  //     }

  //     tableBody.innerHTML = filteredCompanies
  //       .map(
  //         (company, index) => `
  //       <tr>
  //         <td>${index + 1}</td>
  //         <td>${company.name}</td>
  //         <td>${new Date(company.created_at).toLocaleDateString()}</td>
  //       </tr>
  //     `
  //       )
  //       .join('')
  //   }

  //   setupEventListeners() {
  //     const addCompanyBtn = this.container.querySelector('#addCompanyBtn')
  //     const modal = this.container.querySelector('#addCompanyModal')
  //     const closeModalBtn = this.container.querySelector('#closeModalBtn')
  //     const addCompanyForm = this.container.querySelector('#addCompanyForm')
  //     const searchInput = this.container.querySelector('#searchCompanies')

  //     addCompanyBtn.addEventListener('click', () => {
  //       modal.style.display = 'block'
  //     })

  //     closeModalBtn.addEventListener('click', () => {
  //       modal.style.display = 'none'
  //     })

  //     window.addEventListener('click', (event) => {
  //       if (event.target === modal) {
  //         modal.style.display = 'none'
  //       }
  //     })

  //     addCompanyForm.addEventListener('submit', async (event) => {
  //       event.preventDefault()
  //       const companyName = event.target.elements.name.value

  //       try {
  //         await postJson('/companies', { name: companyName })
  //         showToast('Company created successfully!')
  //         modal.style.display = 'none'
  //         addCompanyForm.reset()
  //         await this.loadCompanies()
  //       } catch (error) {
  //         showToast(error.error || 'Failed to create company.', false)
  //       }
  //     })

  //     searchInput.addEventListener('input', (event) => {
  //       this.searchQuery = event.target.value
  //       this.renderTable()
  //     })
  //   }

  //   destroy() {
  //     this.container.innerHTML = ''
  //   }
  // }

  // --- App ---

  const API_BASE = window.API_BASE
    ? window.API_BASE
    : window.location && window.location.port === '8000'
    ? 'http://localhost:8001'
    : '../backend/api'

  const componentMap = {
    dashboard: DashboardComponent,
    companies: CompanyComponent,
    'machine-structure': window.MachineStruture || MachineStruture,
    'data-manager': window.DataManagerComponent,
    'company-data-explorer': window.CompanyDataExplorerComponent,
    // Force using the real Users module that we attach to window, never the placeholder fallback class
    users: window.UsersComponent,
    roles: window.RolesComponent,
    permissions: window.PermissionsComponent,
    rolepermissions: window.RolePermissionsComponent,
    tasks: window.TasksComponent,
    workorders: window.WorkOrdersComponent,
    assets: window.AssetsComponent || AssetsComponent,
    // Prefer the real ReportsComponent class if present; fallback to any window export
    reports:
      typeof ReportsComponent !== 'undefined'
        ? ReportsComponent
        : window.ReportsComponent,
    settings: window.SettingsComponent || SettingsComponent,
  }

  async function loadComponent(sectionId) {
    const contentArea = document.getElementById('main-content-area')
    window.API_BASE = API_BASE
    const Ctor = componentMap[sectionId]

    if (
      window.activeComponent &&
      typeof window.activeComponent.destroy === 'function'
    ) {
      window.activeComponent.destroy()
    }
    contentArea.innerHTML = ''

    if (Ctor) {
      window.activeComponent = new Ctor(contentArea)
    } else {
      contentArea.innerHTML = `<div class="error">Component not found for section: ${sectionId}</div>`
    }
  }

  // --- Utility Functions ---

  function showToast(msg, ok = true) {
    let el = document.getElementById('toast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'toast'
      el.className = 'toast'
      document.body.appendChild(el)
    }
    // Reset and apply variant classes to align with styles.css (.toast.success/.toast.error + .show)
    el.className = 'toast ' + (ok ? 'success' : 'error')
    el.textContent = msg

    // Restart CSS transition if it's already visible
    // by forcing a reflow before adding .show again
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth

    // Show with transition
    el.classList.add('show')

    // Auto-hide after 2.5s
    clearTimeout(el._hideTimer)
    el._hideTimer = setTimeout(() => {
      el.classList.remove('show')
    }, 2500)
  }

  async function getJson(path) {
    const token = localStorage.getItem('token')
    let url = `${API_BASE}${path}`
    // Fallback: include token as query param in case servers drop Authorization header
    if (token) {
      url +=
        (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
    }
    const res = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(token ? { 'X-Auth-Token': token } : {}),
      },
    })
    const data = await res.json().catch(() => ({}))

    // Handle Unauthorized globally
    if (res.status === 401) {
      try {
        showToast('Unauthorized. Please login again.', false)
      } catch (e) {}
      localStorage.removeItem('token')
      // Use relative redirect so it works under subdirectories
      window.location.href = 'index.html'
      throw data || { error: 'Unauthorized' }
    }

    if (!res.ok) throw data
    return data
  }

  async function postJson(path, body) {
    const token = localStorage.getItem('token')
    const url = `${API_BASE}${path}`
    // Fallback: also include token in JSON body for servers that strip headers
    const payload = token ? { ...body, token } : body
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(token ? { 'X-Auth-Token': token } : {}), // extra fallback for CGI/proxy stacks
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))

    if (res.status === 401) {
      try {
        showToast('Unauthorized. Please login again.', false)
      } catch (e) {}
      localStorage.removeItem('token')
      window.location.href = 'index.html'
      throw data || { error: 'Unauthorized' }
    }

    if (!res.ok) throw data
    return data
  }

  async function putJson(path, body) {
    const token = localStorage.getItem('token')
    const url = `${API_BASE}${path}`
    // Fallback: also include token in JSON body for servers that strip headers
    const payload = token ? { ...body, token } : body
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(token ? { 'X-Auth-Token': token } : {}), // extra fallback for CGI/proxy stacks
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))

    if (res.status === 401) {
      try {
        showToast('Unauthorized. Please login again.', false)
      } catch (e) {}
      localStorage.removeItem('token')
      window.location.href = 'index.html'
      throw data || { error: 'Unauthorized' }
    }

    if (!res.ok) throw data
    return data
  }

  async function deleteJson(path) {
    const token = localStorage.getItem('token')
    const url = `${API_BASE}${path}`
    // Fallback: also include token in JSON body for servers that strip headers
    const payload = token ? { token } : {}
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(token ? { 'X-Auth-Token': token } : {}), // extra fallback for CGI/proxy stacks
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))

    if (res.status === 401) {
      try {
        showToast('Unauthorized. Please login again.', false)
      } catch (e) {}
      localStorage.removeItem('token')
      window.location.href = 'index.html'
      throw data || { error: 'Unauthorized' }
    }

    if (!res.ok) throw data
    return data
  }

  // Make functions globally available
  window.showToast = showToast
  window.getJson = getJson
  window.postJson = postJson
  window.putJson = putJson
  window.deleteJson = deleteJson

  // --- App Initialization ---

  function renderShell() {
    document.body.innerHTML = `
      <div class="dashboard-container">
        <div class="sidebar" id="sidebar-container"></div>
        <div class="main-content">
          <div id="main-content-area"></div>
        </div>
      </div>
    `
  }

  async function fetchUser() {
    try {
      const data = await getJson('/auth/me')
      window.user = data.user
    } catch (e) {
      console.error('Failed to fetch user:', e)
      // Redirect to login on auth failure
      localStorage.removeItem('token')
      window.location.href = 'index.html'
    }
  }

  async function init() {
    // Redirect to login if not authenticated
    if (!localStorage.getItem('token')) {
      window.location.href = 'index.html'
      return
    }

    renderShell()

    // Fetch user info
    await fetchUser()

    // Initialize sidebar
    const sidebarContainer = document.getElementById('sidebar-container')
    if (sidebarContainer) {
      window.sidebarComponent = new SidebarComponent(sidebarContainer)
    }

    // Load initial component based on URL hash
    const hash = window.location.hash.substring(1) || 'dashboard'
    await loadComponent(hash)

    // Listen for section changes
    document.addEventListener('sectionChanged', async (e) => {
      await loadComponent(e.detail.sectionId)
    })
  }

  // Start the app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
