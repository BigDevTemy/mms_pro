class SidebarComponent {
  constructor(container) {
    this.container = container
    this.currentSection = 'dashboard'
    this.init()
  }

  init() {
    this.render()
    this.attachEventListeners()
    this.setActiveSection()
  }

  render() {
    const roles = window.user?.roles || []
    const isSuperadmin = roles.some((r) => r.name === 'superadmin')
    const isCompanyAdmin = roles.some((r) => r.name === 'company_admin')
    const isTechnician = roles.some((r) => r.name === 'technician')

    let html = `
      <div class="sidebar-header">
        <i class="fas fa-bolt logo-icon"></i>
        <h2>MMS Pro</h2>
      </div>
      <nav class="sidebar-nav">
        <ul>
          <li><a href="#dashboard" data-section="dashboard"><i class="fas fa-tachometer-alt"></i> Dashboard</a></li>
    `

    if (isSuperadmin) {
      html += `
          <li class="has-submenu">
            <a href="#" class="submenu-toggle" data-section="companies">
              <i class="fas fa-building"></i> Companies
              <i class="fas fa-chevron-down submenu-arrow"></i>
            </a>
            <ul class="submenu">
              <li><a href="#companies" data-section="companies"><i class="fas fa-list"></i> All Companies</a></li>
              <li><a href="#machine-structure" data-section="machine-structure"><i class="fas fa-project-diagram"></i> Machine Structure</a></li>
              <li><a href="#data-manager" data-section="data-manager"><i class="fas fa-database"></i> Data Manager</a></li>
              <li><a href="#company-data-explorer" data-section="company-data-explorer"><i class="fas fa-table"></i> Data Explorer</a></li>
            </ul>
          </li>
      `
    }

    if (isCompanyAdmin) {
      html += `
          <li class="has-submenu">
            <a href="#" class="submenu-toggle" data-section="companies">
              <i class="fas fa-building"></i> Companies
              <i class="fas fa-chevron-down submenu-arrow"></i>
            </a>
            <ul class="submenu">
              <li><a href="#companies" data-section="companies"><i class="fas fa-list"></i> All Companies</a></li>
              <li><a href="#company-data-explorer" data-section="company-data-explorer"><i class="fas fa-table"></i> Data Explorer</a></li>
            </ul>
          </li>
      `
    }

    if (isSuperadmin || isCompanyAdmin) {
      html += `
          <li class="has-submenu">
            <a href="#" class="submenu-toggle" data-section="users">
              <i class="fas fa-users"></i> Users
              <i class="fas fa-chevron-down submenu-arrow"></i>
            </a>
            <ul class="submenu">
              <li><a href="#users" data-section="users"><i class="fas fa-user-cog"></i> User Management</a></li>
              <li><a href="#roles" data-section="roles"><i class="fas fa-user-shield"></i> Roles</a></li>
              <li><a href="#permissions" data-section="permissions"><i class="fas fa-key"></i> Permissions</a></li>
              <li><a href="#rolepermissions" data-section="rolepermissions"><i class="fas fa-key"></i> Role/Permissions</a></li>
            </ul>
          </li>
          <li><a href="#tasks" data-section="tasks"><i class="fas fa-clipboard-check"></i> Tasks</a></li>
      `
    }

    html += `
          <li><a href="#workorders" data-section="workorders"><i class="fas fa-clipboard-list"></i> Work Orders</a></li>
          <li><a href="#assets" data-section="assets"><i class="fas fa-tools"></i> Assets</a></li>
          <li><a href="#reports" data-section="reports"><i class="fas fa-chart-bar"></i> Reports</a></li>
          <li><a href="#settings" data-section="settings"><i class="fas fa-cog"></i> Settings</a></li>
        </ul>
      </nav>
      <div class="sidebar-footer">
        <a href="#" id="logout"><i class="fas fa-sign-out-alt"></i> Logout</a>
      </div>
    `

    this.container.innerHTML = html
  }

  attachEventListeners() {
    const nav = this.container.querySelector('.sidebar-nav')
    if (nav) {
      nav.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-section]')
        if (!link) return

        e.preventDefault()
        const section = link.dataset.section

        if (link.classList.contains('submenu-toggle')) {
          this.toggleSubmenu(link)
        } else {
          this.switchToSection(section)
        }
      })
    }

    // Logout
    const logoutBtn = this.container.querySelector('#logout')
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault()
        this.logout()
      })
    }

    // Close submenus when clicking outside
    document.addEventListener('click', (e) => {
      if (
        !e.target.closest('.has-submenu') &&
        !e.target.closest('.submenu-toggle')
      ) {
        this.closeAllSubmenus()
      }
    })
  }

  toggleSubmenu(toggle) {
    const parent = toggle.closest('.has-submenu')
    const submenu = parent.querySelector('.submenu')
    const isOpen = parent.classList.contains('open')

    // Close all other submenus
    this.closeAllSubmenus()

    if (!isOpen) {
      parent.classList.add('open')
      submenu.style.maxHeight = submenu.scrollHeight + 'px'
      submenu.style.opacity = '1'
      submenu.style.visibility = 'visible'

      const arrow = toggle.querySelector('.submenu-arrow')
      if (arrow) {
        arrow.style.transform = 'rotate(180deg)'
      }
    }
  }

  closeAllSubmenus() {
    const openMenus = this.container.querySelectorAll('.has-submenu.open')
    openMenus.forEach((menu) => {
      menu.classList.remove('open')
      const submenu = menu.querySelector('.submenu')
      if (submenu) {
        submenu.style.maxHeight = '0'
        submenu.style.opacity = '0'
        submenu.style.visibility = 'hidden'
      }

      const arrow = menu.querySelector('.submenu-arrow')
      if (arrow) {
        arrow.style.transform = 'rotate(0deg)'
      }
    })
  }

  switchToSection(sectionId) {
    this.currentSection = sectionId

    // Update active states
    this.container.querySelectorAll('.sidebar-nav a').forEach((link) => {
      link.classList.remove('active')
    })

    const activeLink = this.container.querySelector(
      `[data-section="${sectionId}"]`
    )
    if (activeLink) {
      activeLink.classList.add('active')

      // If it's in a submenu, open the parent menu
      const parentMenu = activeLink.closest('.has-submenu')
      if (parentMenu) {
        parentMenu.classList.add('open')
        const submenu = parentMenu.querySelector('.submenu')
        if (submenu) {
          submenu.style.maxHeight = submenu.scrollHeight + 'px'
          submenu.style.opacity = '1'
          submenu.style.visibility = 'visible'
        }
      }
    }

    // Update URL hash
    window.location.hash = sectionId

    // Dispatch custom event for section change
    const event = new CustomEvent('sectionChanged', {
      detail: { sectionId },
    })
    document.dispatchEvent(event)
  }

  setActiveSection() {
    const hash = window.location.hash.substring(1) || 'dashboard'
    this.switchToSection(hash)
  }

  logout() {
    localStorage.removeItem('token')
    window.location.href = '/mms_pro/public/'
  }

  // Public methods
  getCurrentSection() {
    return this.currentSection
  }

  navigateTo(sectionId) {
    this.switchToSection(sectionId)
  }
}
