/**
 * DataManagerComponent - Dynamic CRUD UI for applied per-company schema (Option A)
 * - Works with generic backend endpoints:
 *   GET/POST   /companies/{companyId}/data/{typeKey}
 *   GET/PUT/DELETE /companies/{companyId}/data/{typeKey}/{id}
 * - Derives fields and required parent from the saved structure (nodeTypes + rules)
 * - No hardcoding for specific types; adapts to any design you apply
 */
class DataManagerComponent {
  constructor(container) {
    this.container = container

    // State
    this.companyId = null
    this.structure = null
    this.companies = []
    this.typesMap = {} // key -> type def
    this.childParent = {} // childType -> single parentType (first rule wins)
    this.multiParent = {} // childType -> true if multiple parents detected
    this.selectedTypeKey = ''
    this.parentItems = [] // loaded parent items for the selected type
    this.selectedParentId = '' // selected parent id for filtering/creating
    this.items = []

    // UI state
    this.loading = false
    this.saving = false
    this.deleting = false
    this.error = null

    this.init()
  }

  // ---------- Lifecycle ----------
  async init() {
    this.renderShell()
    await this.loadCompanies()
    // Do not auto-select company or type; wait for user input
    this.companyId = null
    this.selectedTypeKey = ''
    this.parentItems = []
    this.items = []
    this.render()
  }

  // ---------- API helpers ----------
  apiBase() {
    return window.API_BASE || '../backend/api'
  }

  async getJson(path) {
    // delegate to global helper (adds token fallback, etc.)
    return window.getJson(path)
  }

  async postJson(path, body) {
    return window.postJson(path, body)
  }

  async putJson(path, body) {
    const token = localStorage.getItem('token')
    const url = `${this.apiBase()}${path}`
    const payload = token ? { ...body, token } : body
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(token ? { 'X-Auth-Token': token } : {}),
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw data
    return data
  }

  async deleteJson(path) {
    const token = localStorage.getItem('token')
    const url = `${this.apiBase()}${path}`
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(token ? { 'X-Auth-Token': token } : {}),
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw data
    return data
  }

  // ---------- Data loading ----------
  async loadCompanies() {
    try {
      const res = await this.getJson('/companies')
      this.companies = Array.isArray(res) ? res : res.items || []
    } catch (e) {
      this.companies = []
    }
  }

  async loadStructure() {
    if (!this.companyId) return
    this.loading = true
    this.renderHeader() // update header immediately
    try {
      const res = await this.getJson(
        `/companies/${this.companyId}/machine-structure`
      )
      if (!res || !res.structure) {
        this.structure = {
          nodeTypes: [],
          rules: [],
          tree: { type: 'root', children: [] },
        }
      } else {
        this.structure = res.structure
      }
      this.rebuildMaps()
    } catch (e) {
      this.structure = {
        nodeTypes: [],
        rules: [],
        tree: { type: 'root', children: [] },
      }
      this.typesMap = {}
      this.childParent = {}
      this.multiParent = {}
    } finally {
      this.loading = false
    }
  }

  rebuildMaps() {
    // Types map
    this.typesMap = {}
    for (const nt of this.structure?.nodeTypes || []) {
      if (nt && nt.key) this.typesMap[nt.key] = nt
    }

    // Start with rule-defined relationships
    this.childParent = {}
    this.multiParent = {}
    for (const r of this.structure?.rules || []) {
      const p = r?.parent
      const c = r?.child
      if (!p || !c) continue
      if (!this.childParent[c]) this.childParent[c] = p
      else if (this.childParent[c] !== p) this.multiParent[c] = true
    }

    // Merge in relationships derived from the current tree ordering
    const { childParent: treeCP, multiParent: treeMP } =
      this.deriveChildParentFromTree(this.structure?.tree)
    for (const c of Object.keys(treeCP)) {
      const p = treeCP[c]
      if (!this.childParent[c]) this.childParent[c] = p
      else if (this.childParent[c] !== p) this.multiParent[c] = true
    }
    for (const c of Object.keys(treeMP)) {
      this.multiParent[c] = true
    }
  }

  parentType(typeKey) {
    if (this.multiParent[typeKey]) return null // ambiguous
    return this.childParent[typeKey] || null
  }

  // Derive child->parent mapping from a tree snapshot
  deriveChildParentFromTree(root) {
    const childParent = {}
    const multiParent = {}

    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      const parentType = node.type || 'root'
      const children = Array.isArray(node.children) ? node.children : []
      for (const ch of children) {
        if (!ch || typeof ch !== 'object') continue
        const childType = ch.type
        if (
          parentType &&
          childType &&
          parentType !== 'root' &&
          childType !== 'root' &&
          parentType !== childType
        ) {
          if (!childParent[childType]) {
            childParent[childType] = parentType
          } else if (childParent[childType] !== parentType) {
            multiParent[childType] = true
          }
        }
        walk(ch)
      }
    }

    walk(root || { type: 'root', children: [] })
    return { childParent, multiParent }
  }

  async loadParentItems() {
    this.parentItems = []
    this.selectedParentId = ''
    const pType = this.parentType(this.selectedTypeKey)
    if (!pType) return
    try {
      const res = await this.getJson(
        `/companies/${this.companyId}/data/${encodeURIComponent(pType)}`
      )
      this.parentItems = Array.isArray(res?.items) ? res.items : []
      // keep existing selectedParentId if still valid
      if (
        this.selectedParentId &&
        !this.parentItems.some(
          (x) => String(x.id) === String(this.selectedParentId)
        )
      ) {
        this.selectedParentId = ''
      }
    } catch (e) {
      this.parentItems = []
    }
  }

  async loadItems() {
    this.items = []
    if (!this.companyId || !this.selectedTypeKey) return
    try {
      const pType = this.parentType(this.selectedTypeKey)
      const params = new URLSearchParams()
      if (pType && this.selectedParentId) {
        params.set(
          `${this.sanitizeIdent(pType)}_id`,
          String(this.selectedParentId)
        )
      }
      const qs = params.toString() ? `?${params.toString()}` : ''
      const res = await this.getJson(
        `/companies/${this.companyId}/data/${encodeURIComponent(
          this.selectedTypeKey
        )}${qs}`
      )
      this.items = Array.isArray(res?.items) ? res.items : []
    } catch (e) {
      this.items = []
    }
  }

  async refreshParentAndItems() {
    if (!this.companyId || !this.selectedTypeKey) {
      this.parentItems = []
      this.items = []
      return
    }
    await this.loadParentItems()
    await this.loadItems()
  }

  // ---------- Mutations ----------
  sanitizeIdent(raw) {
    let id = String(raw || '')
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .toLowerCase()
    id = id.replace(/^_+|_+$/g, '')
    if (!id || /\d/.test(id[0])) id = 'f_' + id
    return id
  }

  attrDefsForSelected() {
    const def = this.typesMap[this.selectedTypeKey] || {}
    return Array.isArray(def.attributes) ? def.attributes : []
  }

  collectFormValues() {
    const form = this.container.querySelector('.dm-form')
    const attrs = this.attrDefsForSelected()
    const out = {}

    // Include parent id if applicable
    const pType = this.parentType(this.selectedTypeKey)
    if (pType) {
      const parentCol = `${this.sanitizeIdent(pType)}_id`
      const sel = form ? form.querySelector(`[name="${parentCol}"]`) : null
      if (sel && sel.value !== '') {
        out[parentCol] = parseInt(sel.value, 10)
      }
    }

    // Collect attributes: send BOTH raw keys and attr_* keys for maximum compatibility
    for (const a of attrs) {
      const key = a.key
      const input = form ? form.querySelector(`[name="attr_${key}"]`) : null
      if (!input) continue
      const raw = input.value
      let v = raw

      switch (a.type) {
        case 'integer':
          v = raw === '' ? null : parseInt(raw, 10)
          break
        case 'number':
          v = raw === '' ? null : parseFloat(raw)
          break
        case 'boolean':
          v = String(raw) === 'true'
          break
        case 'date':
          v = raw || null
          break
        case 'json':
          if (!raw) v = null
          else {
            try {
              v = JSON.parse(raw)
            } catch {
              v = raw
            } // let server validate if not valid JSON
          }
          break
        default:
          v = raw
      }

      // Add as raw attribute key (e.g., name) and duplicated with attr_ prefix
      out[key] = v
      out[`attr_${key}`] = v
    }

    return out
  }

  async createItem() {
    if (!this.selectedTypeKey) return
    const token = localStorage.getItem('token') || ''
    if (!token) {
      window.showToast('Login required', false)
      return
    }
    this.saving = true
    // Collect form values BEFORE any re-render to avoid wiping inputs
    const payload = this.collectFormValues()
    // Disable the create button without re-rendering
    const btnCreate = this.container.querySelector('.dm-form .ms-btn.success')
    if (btnCreate) btnCreate.disabled = true
    try {
      const data = await this.postJson(
        `/companies/${this.companyId}/data/${encodeURIComponent(
          this.selectedTypeKey
        )}`,
        payload
      )
      window.showToast('Created')
      // clear attr inputs
      const form = this.container.querySelector('.dm-form')
      if (form) {
        ;[
          ...form.querySelectorAll(
            'input[type="text"], input[type="number"], input[type="date"], textarea'
          ),
        ].forEach((el) => {
          if (el.name && !el.name.endsWith('_id')) el.value = ''
        })
      }
      await this.loadItems()
      this.renderTable()
    } catch (e) {
      const msg = e?.error || e?.detail || 'Create failed'
      window.showToast(msg, false)
    } finally {
      this.saving = false
      // Re-enable button if we disabled it
      const btn = this.container.querySelector('.dm-form .ms-btn.success')
      if (btn) btn.disabled = false
      this.renderHeader()
    }
  }

  async deleteItem(id) {
    if (!this.selectedTypeKey || !id) return
    const token = localStorage.getItem('token') || ''
    if (!token) {
      window.showToast('Login required', false)
      return
    }
    this.deleting = true
    try {
      await this.deleteJson(
        `/companies/${this.companyId}/data/${encodeURIComponent(
          this.selectedTypeKey
        )}/${id}`
      )
      window.showToast('Deleted')
      await this.loadItems()
      this.renderTable()
    } catch (e) {
      const msg = e?.error || e?.detail || 'Delete failed'
      window.showToast(msg, false)
    } finally {
      this.deleting = false
      this.renderHeader()
    }
  }

  // ---------- Rendering ----------
  renderShell() {
    this.container.innerHTML = `
      <div class="dm-card ms-card">
        <div class="hd">Schema Data Manager (Dynamic)</div>
        <div class="bd">
          <div id="dm-header"></div>
          <div class="dm-grid">
            <div class="dm-left ms-card">
              <div class="hd">Create</div>
              <div class="bd"><div id="dm-form"></div></div>
            </div>
            <div class="dm-right ms-card">
              <div class="hd">Items</div>
              <div class="bd"><div id="dm-table"></div></div>
            </div>
          </div>
        </div>
      </div>
    `
    const style = document.createElement('style')
    style.textContent = `
      .dm-grid { display: grid; grid-template-columns: 380px 1fr; gap: 16px; margin-top: 12px; }
      .dm-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
      .dm-row .ms-select, .dm-row .ms-input, .dm-row button { height: auto; }
      .dm-form .row { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .dm-form .row label { width: 120px; color:#6b7280; font-size: 12px; }
      .dm-form .row input, .dm-form .row select, .dm-form .row textarea { flex: 1; }
      .dm-table table { width: 100%; border-collapse: collapse; }
      .dm-table th, .dm-table td { text-align: left; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
      .dm-table th { background: #f9fafb; }
      .spacer { flex: 1; }
    `
    this.container.appendChild(style)
  }

  render() {
    this.renderHeader()
    this.renderForm()
    this.renderTable()
  }

  renderHeader() {
    const mount = this.container.querySelector('#dm-header')
    if (!mount) return

    const wrap = document.createElement('div')
    wrap.className = 'dm-row'

    // Company select (if available), else numeric input
    let companyCtl
    if (this.companies.length) {
      companyCtl = document.createElement('select')
      companyCtl.className = 'ms-select'
      companyCtl.appendChild(new Option('Select Company', ''))
      for (const co of this.companies) {
        const opt = new Option(co.name, String(co.id))
        companyCtl.appendChild(opt)
      }
      companyCtl.value = this.companyId ? String(this.companyId) : ''
      companyCtl.addEventListener('change', async (e) => {
        const val = e.target.value
        const v = parseInt(val, 10)
        if (!val) {
          this.companyId = null
          this.selectedTypeKey = ''
          this.selectedParentId = ''
          this.parentItems = []
          this.items = []
          this.render()
          return
        }
        if (!isNaN(v) && v > 0) {
          this.companyId = v
          await this.loadStructure()
          // do not auto-pick a type; user must choose based on structure
          this.selectedTypeKey = ''
          this.selectedParentId = ''
          this.parentItems = []
          this.items = []
          this.render()
        }
      })
    } else {
      companyCtl = document.createElement('input')
      companyCtl.type = 'number'
      companyCtl.min = '1'
      companyCtl.value = this.companyId || ''
      companyCtl.className = 'ms-input'
      companyCtl.style.width = '160px'
      companyCtl.addEventListener('change', async (e) => {
        const v = parseInt(e.target.value, 10)
        if (!isNaN(v) && v > 0) {
          this.companyId = v
          await this.loadStructure()
          this.selectedTypeKey = ''
          this.selectedParentId = ''
          this.parentItems = []
          this.items = []
          this.render()
        }
      })
    }

    const lblCompany = document.createElement('label')
    lblCompany.className = 'small muted'
    lblCompany.textContent = 'Company'

    // Type select
    const typeSel = document.createElement('select')
    typeSel.className = 'ms-select'
    const typeKeys = Object.keys(this.typesMap)
    typeSel.appendChild(new Option('Select Type', ''))
    for (const k of typeKeys) {
      const def = this.typesMap[k]
      typeSel.appendChild(new Option(def?.label || k, k))
    }
    typeSel.value = this.selectedTypeKey || ''
    typeSel.disabled = !this.companyId || typeKeys.length === 0
    typeSel.addEventListener('change', async (e) => {
      this.selectedTypeKey = e.target.value
      this.selectedParentId = ''
      await this.refreshParentAndItems()
      this.render()
    })

    // Parent select (when single parent)
    const pType = this.parentType(this.selectedTypeKey)
    let parentSel = null
    if (pType) {
      parentSel = document.createElement('select')
      parentSel.className = 'ms-select'
      parentSel.appendChild(
        new Option(`All ${this.typesMap[pType]?.label || pType}`, '')
      )
      for (const p of this.parentItems) {
        const text = p.name || `#${p.id}`
        parentSel.appendChild(new Option(text, String(p.id)))
      }
      parentSel.value = this.selectedParentId
      parentSel.addEventListener('change', async (e) => {
        this.selectedParentId = e.target.value
        await this.loadItems()
        this.renderTable()
      })
    }

    // Buttons
    const btnReload = this.button(
      this.loading ? 'Loading...' : 'Reload',
      async () => {
        await this.loadStructure()
        await this.refreshParentAndItems()
        this.render()
      }
    )

    const btnRefreshItems = this.button('Refresh Items', async () => {
      await this.loadItems()
      this.renderTable()
    })

    wrap.appendChild(lblCompany)
    wrap.appendChild(companyCtl)

    const lblType = document.createElement('label')
    lblType.className = 'small muted'
    lblType.textContent = 'Type'
    wrap.appendChild(lblType)
    wrap.appendChild(typeSel)

    if (parentSel) {
      const lblParent = document.createElement('label')
      lblParent.className = 'small muted'
      lblParent.textContent = this.typesMap[pType]?.label || pType
      wrap.appendChild(lblParent)
      wrap.appendChild(parentSel)
    }

    wrap.appendChild(this.h('span', 'spacer'))
    wrap.appendChild(btnReload)
    wrap.appendChild(btnRefreshItems)

    mount.innerHTML = ''
    mount.appendChild(wrap)
  }

  renderForm() {
    const mount = this.container.querySelector('#dm-form')
    if (!mount) return
    mount.innerHTML = ''

    if (!this.companyId) {
      mount.appendChild(this.h('div', 'muted', 'Select a company'))
      return
    }
    if (!this.selectedTypeKey) {
      mount.appendChild(this.h('div', 'muted', 'Select a type'))
      return
    }

    const def = this.typesMap[this.selectedTypeKey] || {}
    const form = document.createElement('div')
    form.className = 'dm-form'

    // Help line
    form.appendChild(
      this.h(
        'div',
        'small muted',
        `Create ${def.label || this.selectedTypeKey}`
      )
    )

    // Parent picker inside form (required for create when single parent)
    const pType = this.parentType(this.selectedTypeKey)
    if (pType) {
      const row = document.createElement('div')
      row.className = 'row'
      const label = document.createElement('label')
      label.textContent = `${this.typesMap[pType]?.label || pType}`
      const sel = document.createElement('select')
      sel.className = 'ms-select'
      sel.name = `${this.sanitizeIdent(pType)}_id`
      sel.appendChild(new Option('Select...', ''))
      for (const p of this.parentItems) {
        const text = p.name || `#${p.id}`
        sel.appendChild(new Option(text, String(p.id)))
      }
      sel.value = this.selectedParentId || ''
      sel.addEventListener('change', (e) => {
        this.selectedParentId = e.target.value
      })
      row.appendChild(label)
      row.appendChild(sel)
      form.appendChild(row)
    }

    // Attribute inputs
    const attrs = this.attrDefsForSelected()
    for (const a of attrs) {
      const row = document.createElement('div')
      row.className = 'row'
      const label = document.createElement('label')
      label.textContent = a.label || a.key
      let input
      switch (a.type) {
        case 'integer': {
          input = document.createElement('input')
          input.type = 'number'
          input.step = '1'
          break
        }
        case 'number': {
          input = document.createElement('input')
          input.type = 'number'
          break
        }
        case 'boolean': {
          input = document.createElement('select')
          input.appendChild(new Option('false', 'false'))
          input.appendChild(new Option('true', 'true'))
          break
        }
        case 'date': {
          input = document.createElement('input')
          input.type = 'date'
          break
        }
        case 'json': {
          input = document.createElement('textarea')
          input.rows = 3
          break
        }
        default: {
          input = document.createElement('input')
          input.type = 'text'
        }
      }
      input.className = 'ms-input'
      input.name = `attr_${a.key}`
      row.appendChild(label)
      row.appendChild(input)
      if (a.required) {
        row.appendChild(this.h('span', 'small muted', '(required)'))
      }
      form.appendChild(row)
    }

    const btnCreate = this.button(
      this.saving ? 'Creating...' : 'Create',
      () => this.createItem(),
      'success'
    )
    btnCreate.disabled = this.saving || !this.selectedTypeKey
    form.appendChild(btnCreate)

    mount.appendChild(form)
  }

  renderTable() {
    const mount = this.container.querySelector('#dm-table')
    if (!mount) return
    const wrap = document.createElement('div')
    wrap.className = 'dm-table'

    if (!this.companyId) {
      wrap.appendChild(this.h('div', 'muted', 'Select a company'))
      mount.innerHTML = ''
      mount.appendChild(wrap)
      return
    }

    if (!this.selectedTypeKey) {
      wrap.appendChild(this.h('div', 'muted', 'Select a type'))
      mount.innerHTML = ''
      mount.appendChild(wrap)
      return
    }

    // Columns: id, parentCol (if any), and all defined attributes
    const headerCols = ['id']
    const pType = this.parentType(this.selectedTypeKey)
    const parentCol = pType ? `${this.sanitizeIdent(pType)}_id` : null
    if (parentCol) headerCols.push(parentCol)

    const attrCols = this.attrDefsForSelected().map((a) =>
      this.sanitizeIdent(a.key)
    )
    for (const col of attrCols) headerCols.push(col)

    // If API returns additional columns (e.g., created_at) or structure is stale,
    // include union of item keys so values are visible.
    const exclude = new Set(['actions'])
    const firstItem =
      Array.isArray(this.items) && this.items.length ? this.items[0] : null
    if (firstItem && typeof firstItem === 'object') {
      for (const key of Object.keys(firstItem)) {
        if (!headerCols.includes(key)) headerCols.push(key)
      }
    }
    headerCols.push('actions')

    // Warn if attributes are missing from the table (likely need "Run Schema")
    if (firstItem) {
      const itemKeys = new Set(Object.keys(firstItem))
      const missing = attrCols.filter((c) => !itemKeys.has(c))
      if (missing.length) {
        const warn = document.createElement('div')
        warn.className = 'error'
        warn.textContent =
          'Some attributes are missing in the physical table: ' +
          missing.join(', ') +
          '. Click "Run Schema" in the Machine Structure builder to materialize new columns.'
        wrap.appendChild(warn)
      }
    }

    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const thr = document.createElement('tr')
    for (const c of headerCols) {
      const th = document.createElement('th')
      th.textContent = c
      thr.appendChild(th)
    }
    thead.appendChild(thr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    if (!Array.isArray(this.items) || !this.items.length) {
      const tr = document.createElement('tr')
      const td = document.createElement('td')
      td.colSpan = headerCols.length
      td.textContent = 'No items'
      tr.appendChild(td)
      tbody.appendChild(tr)
    } else {
      for (const row of this.items) {
        const tr = document.createElement('tr')
        for (const c of headerCols) {
          if (c === 'actions') continue
          const td = document.createElement('td')
          let v = row[c]
          if (typeof v === 'object' && v !== null) v = JSON.stringify(v)
          td.textContent = v == null ? '' : String(v)
          tr.appendChild(td)
        }
        // actions
        const tdAct = document.createElement('td')
        const btnDel = this.button(
          'Delete',
          () => this.deleteItem(row.id),
          'warn'
        )
        tdAct.appendChild(btnDel)
        tr.appendChild(tdAct)
        tbody.appendChild(tr)
      }
    }
    table.appendChild(tbody)
    wrap.appendChild(table)

    mount.innerHTML = ''
    mount.appendChild(wrap)
  }

  // ---------- UI utils ----------
  button(label, onClick, variant = '') {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'ms-btn' + (variant ? ` ${variant}` : '')
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  h(tag, className, text) {
    const el = document.createElement(tag)
    if (className) el.className = className
    if (text != null) el.textContent = text
    return el
  }

  destroy() {
    this.container.innerHTML = ''
  }
}

// Expose globally for app.js registration
window.DataManagerComponent = DataManagerComponent
