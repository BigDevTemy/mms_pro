class CompanyComponent {
  constructor(container) {
    this.container = container
    this.companies = []
    this.searchQuery = ''
    this.limit = 10
    this.offset = 0
    this.total = 0
    this.editingCompany = null
    this.init()
  }

  async init() {
    this.renderLayout()
    this.setupEventListeners()
    await this.loadCompanies()
  }

  renderLayout() {
    this.container.innerHTML = `
      <div class="company-header">
        <button class="btn btn-primary" id="addCompanyBtn">Add Company</button>
        <div class="search-container">
          <input type="text" id="searchCompanies" class="form-control" placeholder="Search companies...">
        </div>
      </div>
      <div class="table-responsive">
        <table id="companiesTable" class="table table-striped">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <!-- Company rows will be inserted here -->
          </tbody>
        </table>
      </div>
      <div class="pagination-container" id="paginationContainer">
        <!-- Pagination will be inserted here -->
      </div>

      <!-- Add/Edit Company Modal -->
      <div id="addCompanyModal" class="modal" style="display:none;">
        <div class="modal-content">
          <div class="modal-header">
            <h2 id="modalTitle">Add New Company</h2>
            <span class="close-btn" id="closeModalBtn">&times;</span>
          </div>
          <div class="modal-body">
            <form id="addCompanyForm">
              <div class="form-group">
                <label for="companyName">Company Name</label>
                <input type="text" id="companyName" name="name" class="form-control" required>
              </div>
              <button type="submit" class="btn btn-primary" id="submitBtn">Create Company</button>
            </form>
          </div>
        </div>
      </div>
    `
  }

  async loadCompanies() {
    // Show loading state
    const tableBody = this.container.querySelector('#companiesTable tbody')
    if (tableBody) {
      tableBody.innerHTML =
        '<tr><td colspan="3" class="text-center"><span class="spinner"></span> Loading companies...</td></tr>'
    }

    try {
      const qs = `?limit=${this.limit}&offset=${
        this.offset
      }&q=${encodeURIComponent(this.searchQuery)}`
      const response = await getJson(`/companies${qs}`)
      this.companies = response.items || response
      this.total = response.total || this.companies.length
      this.renderTable()
      this.renderPagination()
    } catch (error) {
      console.error('Error loading companies:', error)
      if (tableBody) {
        tableBody.innerHTML =
          '<tr><td colspan="3" class="text-center text-danger">Failed to load companies</td></tr>'
      }
      showToast(error.error || 'Failed to load companies.', false)
    }
  }

  renderTable() {
    const tableBody = this.container.querySelector('#companiesTable tbody')

    if (this.companies.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="3">No companies found.</td></tr>'
      return
    }

    tableBody.innerHTML = this.companies
      .map(
        (company, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${company.name}</td>
        <td>
          <button class="btn btn-sm btn-primary edit-btn" data-id="${
            company.id
          }">Edit</button>
          <button class="btn btn-sm btn-danger delete-btn" data-id="${
            company.id
          }">Delete</button>
        </td>
      </tr>
    `
      )
      .join('')
  }

  renderPagination() {
    const container = this.container.querySelector('#paginationContainer')
    if (!container) return

    const totalPages = Math.ceil(this.total / this.limit)
    const currentPage = Math.floor(this.offset / this.limit) + 1

    if (totalPages <= 1) {
      container.innerHTML = ''
      return
    }

    let paginationHtml = '<nav><ul class="pagination">'

    // Previous button
    if (currentPage > 1) {
      paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${
        currentPage - 1
      }">Previous</a></li>`
    }

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
      if (i === currentPage) {
        paginationHtml += `<li class="page-item active"><span class="page-link">${i}</span></li>`
      } else {
        paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`
      }
    }

    // Next button
    if (currentPage < totalPages) {
      paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${
        currentPage + 1
      }">Next</a></li>`
    }

    paginationHtml += '</ul></nav>'
    container.innerHTML = paginationHtml

    // Add event listeners
    container.querySelectorAll('.page-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault()
        const page = parseInt(e.target.getAttribute('data-page'))
        if (page) {
          this.offset = (page - 1) * this.limit
          this.loadCompanies()
        }
      })
    })
  }

  setupEventListeners() {
    const addCompanyBtn = this.container.querySelector('#addCompanyBtn')
    const modal = this.container.querySelector('#addCompanyModal')
    const closeModalBtn = this.container.querySelector('#closeModalBtn')
    const addCompanyForm = this.container.querySelector('#addCompanyForm')
    const searchInput = this.container.querySelector('#searchCompanies')

    addCompanyBtn.addEventListener('click', () => {
      this.editingCompany = null
      this.openModal()
    })

    closeModalBtn.addEventListener('click', () => {
      this.closeModal()
    })

    window.addEventListener('click', (event) => {
      if (event.target === modal) {
        this.closeModal()
      }
    })

    addCompanyForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const companyName = event.target.elements.name.value.trim()
      if (!companyName) {
        showToast('Company name is required', false)
        return
      }

      const submitBtn = event.target.querySelector('button')

      // Show loading state
      submitBtn.disabled = true
      submitBtn.innerHTML = '<span class="spinner"></span> Processing...'

      try {
        if (this.editingCompany) {
          await putJson(`/companies/${this.editingCompany.id}`, {
            name: companyName,
          })
          showToast('Company updated successfully!')
        } else {
          await postJson('/companies', { name: companyName })
          showToast('Company created successfully!')
        }
        this.closeModal()
        addCompanyForm.reset()
        await this.loadCompanies()
      } catch (error) {
        console.error('Error saving company:', error)
        showToast(error.error || 'Failed to save company.', false)
      } finally {
        // Reset loading state
        submitBtn.disabled = false
        submitBtn.innerHTML = this.editingCompany
          ? 'Update Company'
          : 'Create Company'
      }
    })

    searchInput.addEventListener('input', (event) => {
      this.searchQuery = event.target.value
      this.offset = 0 // Reset to first page when searching
      this.loadCompanies()
    })

    // Event delegation for edit and delete buttons
    this.container.addEventListener('click', (event) => {
      if (event.target.classList.contains('edit-btn')) {
        const companyId = parseInt(event.target.getAttribute('data-id'))
        const company = this.companies.find((c) => c.id === companyId)
        if (company) {
          this.editCompany(company)
        }
      } else if (event.target.classList.contains('delete-btn')) {
        const companyId = parseInt(event.target.getAttribute('data-id'))
        const company = this.companies.find((c) => c.id === companyId)
        if (company) {
          this.deleteCompany(company)
        }
      }
    })
  }

  openModal() {
    const modal = this.container.querySelector('#addCompanyModal')
    const modalTitle = this.container.querySelector('#modalTitle')
    const submitBtn = this.container.querySelector('#submitBtn')
    const form = this.container.querySelector('#addCompanyForm')

    modalTitle.textContent = this.editingCompany
      ? 'Edit Company'
      : 'Add New Company'
    submitBtn.textContent = this.editingCompany
      ? 'Update Company'
      : 'Create Company'

    if (this.editingCompany) {
      form.elements.name.value = this.editingCompany.name
    } else {
      form.reset()
    }

    modal.style.display = 'block'
  }

  closeModal() {
    const modal = this.container.querySelector('#addCompanyModal')
    modal.style.display = 'none'
    this.editingCompany = null
  }

  editCompany(company) {
    this.editingCompany = company
    this.openModal()
  }

  async deleteCompany(company) {
    if (
      !confirm(
        `Are you sure you want to delete "${company.name}"? This action cannot be undone.`
      )
    ) {
      return
    }

    try {
      await deleteJson(`/companies/${company.id}`)
      showToast('Company deleted successfully!')
      await this.loadCompanies()
    } catch (error) {
      console.error('Error deleting company:', error)
      showToast(error.error || 'Failed to delete company.', false)
    }
  }

  destroy() {
    this.container.innerHTML = ''
  }
}
