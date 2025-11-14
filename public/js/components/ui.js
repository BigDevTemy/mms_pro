/**
 * UI Component System
 * A lightweight, vanilla JavaScript component system for building dynamic UIs
 */
class UIComponent {
  constructor() {
    this.components = {};
    this.instances = new Map();
  }

  /**
   * Register a new component
   * @param {string} name - Component name
   * @param {Function} component - Component factory function
   * @param {boolean} [singleton=false] - Whether the component should be a singleton
   */
  register(name, component, singleton = false) {
    this.components[name] = { factory: component, singleton };
  }

  /**
   * Render a component
   * @param {string} componentName - Name of the component to render
   * @param {HTMLElement|string} container - Container element or selector
   * @param {Object} [data={}] - Data to pass to the component
   * @param {string} [instanceId] - Optional instance ID for stateful components
   * @returns {HTMLElement} Rendered component element
   */
  render(componentName, container, data = {}, instanceId) {
    const component = this.components[componentName];
    if (!component) {
      console.error(`Component ${componentName} not found`);
      return null;
    }

    // Get or create component instance
    const instanceKey = instanceId || componentName;
    let element;
    
    if (component.singleton) {
      if (!this.instances.has(instanceKey)) {
        element = component.factory({ ...data, update: this.update.bind(this, componentName, container, data, instanceKey) });
        this.instances.set(instanceKey, { element, data });
      } else {
        const instance = this.instances.get(instanceKey);
        instance.data = { ...instance.data, ...data };
        element = instance.element;
      }
    } else {
      element = component.factory({ ...data, update: this.update.bind(this, componentName, container, data, instanceKey) });
    }

    // Update DOM if container is provided
    if (container) {
      const target = typeof container === 'string' ? document.querySelector(container) : container;
      if (target) {
        target.innerHTML = '';
        target.appendChild(element);
      }
    }

    return element;
  }

  /**
   * Update a component instance
   * @private
   */
  update(componentName, container, newData, instanceId) {
    return this.render(componentName, container, newData, instanceId);
  }

  /**
   * Create a reusable component with state
   * @param {string} name - Component name
   * @param {Function} renderFn - Render function (props, state, setState) => HTMLElement
   * @param {Object} [initialState={}] - Initial component state
   * @returns {Object} Component instance with render and update methods
   */
  createComponent(name, renderFn, initialState = {}) {
    const component = {
      name,
      state: { ...initialState },
      element: null,
      
      setState(updater) {
        this.state = typeof updater === 'function' 
          ? { ...this.state, ...updater(this.state) }
          : { ...this.state, ...updater };
        this.update();
      },
      
      update() {
        if (this.element && this.element.parentNode) {
          const newElement = renderFn(
            this.props || {},
            this.state,
            this.setState.bind(this)
          );
          this.element.parentNode.replaceChild(newElement, this.element);
          this.element = newElement;
        }
      },
      
      render(props = {}) {
        this.props = props;
        this.element = renderFn(props, this.state, this.setState.bind(this));
        return this.element;
      }
    };
    
    this.register(name, (props) => {
      component.props = { ...props };
      return component.render(props);
    });
    
    return component;
  }

  /**
   * Create HTML element with attributes and children
   * @param {string} tag - HTML tag name
   * @param {Object} [attributes={}] - Element attributes and properties
   * @param {Array|string|HTMLElement} [children=[]] - Child elements or text content
   * @returns {HTMLElement} Created element
   */
  createElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    
    // Handle different types of attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      
      switch (key) {
        case 'className':
          element.className = value;
          break;
          
        case 'textContent':
        case 'innerText':
          element[key] = value;
          break;
          
        case 'style':
          Object.assign(element.style, value);
          break;
          
        case 'dataset':
          Object.entries(value).forEach(([dataKey, dataValue]) => {
            element.dataset[dataKey] = dataValue;
          });
          break;
          
        case 'onClick':
        case 'onSubmit':
        case 'onChange':
        case 'onInput':
          const eventType = key.toLowerCase().substring(2);
          element.addEventListener(eventType, value);
          break;
          
        default:
          if (key.startsWith('on') && key.toLowerCase() in window) {
            element.addEventListener(key.toLowerCase().substring(2), value);
          } else if (key in element) {
            element[key] = value;
          } else {
            element.setAttribute(key, value);
          }
      }
    });
    
    // Handle children
    if (children) {
      const childrenArray = Array.isArray(children) ? children : [children];
      
      childrenArray.forEach(child => {
        if (!child) return;
        
        if (child instanceof HTMLElement || child instanceof Text) {
          element.appendChild(child);
        } else if (typeof child === 'string' || typeof child === 'number') {
          element.appendChild(document.createTextNode(child));
        } else if (Array.isArray(child)) {
          child.forEach(nestedChild => {
            if (nestedChild) element.appendChild(nestedChild);
          });
        }
      });
    }
    
    return element;
  }

    // Append children
    if (Array.isArray(children)) {
      children.forEach(child => {
        if (child instanceof Node) {
          element.appendChild(child);
        } else if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        }
      });
    } else if (children instanceof Node) {
      element.appendChild(children);
    } else if (typeof children === 'string') {
      element.textContent = children;
    }

    return element;
  }
}

// Create global UI instance
const UI = new UIComponent();

// ====================
// Base UI Components
// ====================

// Card Component
UI.register('Card', ({ title, content, footer, className = '', headerActions } = {}) => {
  return UI.createElement('div', { className: `card ${className}` }, [
    (title || headerActions) && UI.createElement('div', { className: 'card-header' }, [
      title && UI.createElement('h3', { className: 'card-title' }, title),
      headerActions && UI.createElement('div', { className: 'card-actions' }, headerActions)
    ]),
    UI.createElement('div', { className: 'card-body' }, content || []),
    footer && UI.createElement('div', { className: 'card-footer' }, footer)
  ].filter(Boolean));
});

// Button Component
UI.register('Button', ({
  label = '',
  onClick,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  className = '',
  disabled = false,
  type = 'button',
  ...rest
} = {}) => {
  const button = UI.createElement('button', {
    type,
    className: `btn btn-${variant} btn-${size} ${className}`,
    onClick,
    disabled,
    ...rest
  });

  const iconElement = icon && UI.createElement('i', { 
    className: `fas fa-${icon} ${iconPosition === 'left' ? 'me-2' : 'ms-2'}` 
  });

  const labelElement = label ? document.createTextNode(label) : null;
  
  if (icon && label) {
    if (iconPosition === 'left') {
      button.append(iconElement, ' ', labelElement);
    } else {
      button.append(labelElement, ' ', iconElement);
    }
  } else {
    button.append(iconElement || labelElement || '');
  }

  return button;
});

// Modal Component
UI.register('Modal', ({
  id,
  title,
  content,
  footer,
  size = 'md',
  onClose,
  className = ''
} = {}) => {
  const modal = UI.createElement('div', { 
    className: `modal fade ${className}`,
    id: id || `modal-${Math.random().toString(36).substr(2, 9)}`,
    tabIndex: '-1',
    role: 'dialog',
    'aria-hidden': 'true'
  }, [
    UI.createElement('div', { className: `modal-dialog modal-${size}` }, [
      UI.createElement('div', { className: 'modal-content' }, [
        // Header
        UI.createElement('div', { className: 'modal-header' }, [
          title && UI.createElement('h5', { className: 'modal-title' }, title),
          UI.createElement('button', {
            type: 'button',
            className: 'btn-close',
            'data-bs-dismiss': 'modal',
            'aria-label': 'Close',
            onClick: onClose
          })
        ].filter(Boolean)),
        
        // Body
        UI.createElement('div', { className: 'modal-body' }, content || []),
        
        // Footer
        footer && UI.createElement('div', { className: 'modal-footer' }, footer)
      ])
    ])
  ]);

  // Initialize Bootstrap modal if available
  if (window.bootstrap && window.bootstrap.Modal) {
    const bsModal = new bootstrap.Modal(modal);
    modal.show = () => bsModal.show();
    modal.hide = () => bsModal.hide();
  }

  return modal;
});

// Table Component
UI.register('Table', ({
  headers = [],
  data = [],
  keyField = 'id',
  className = '',
  rowClassName = '',
  onRowClick,
  emptyMessage = 'No data available',
  loading = false
} = {}) => {
  const table = UI.createElement('div', { className: 'table-responsive' }, [
    UI.createElement('table', { 
      className: `table table-hover ${className}` 
    }, [
      // Table header
      UI.createElement('thead', {}, [
        UI.createElement('tr', {}, headers.map(header => 
          UI.createElement('th', {
            key: header.key,
            className: header.className,
            style: header.style || {}
          }, header.label || header)
        ))
      ]),
      
      // Table body
      UI.createElement('tbody', {},
        loading
          ? UI.createElement('tr', {}, [
              UI.createElement('td', { 
                colSpan: headers.length,
                className: 'text-center py-4'
              }, 'Loading...')
            ])
          : data.length === 0
            ? UI.createElement('tr', {}, [
                UI.createElement('td', { 
                  colSpan: headers.length,
                  className: 'text-center py-4 text-muted'
                }, emptyMessage)
              ])
            : data.map((row, rowIndex) => {
                const rowKey = row[keyField] || rowIndex;
                return UI.createElement('tr', {
                  key: rowKey,
                  className: `${rowClassName} ${onRowClick ? 'clickable' : ''}`,
                  onClick: onRowClick ? () => onRowClick(row, rowIndex) : null
                }, headers.map((header, colIndex) => {
                  const cellKey = `${rowKey}-${header.key || colIndex}`;
                  const cellValue = header.render 
                    ? header.render(row[header.key], row, rowIndex) 
                    : row[header.key];
                  
                  return UI.createElement('td', { 
                    key: cellKey,
                    className: header.cellClassName,
                    style: header.cellStyle || {}
                  }, cellValue);
                }));
              })
      )
    ])
  ]);

  return table;
});

// Form Components
UI.register('Input', ({
  type = 'text',
  name,
  value = '',
  label,
  placeholder = '',
  className = '',
  inputClassName = '',
  labelClassName = '',
  error,
  helpText,
  onChange,
  ...rest
} = {}) => {
  const id = `input-${name || Math.random().toString(36).substr(2, 9)}`;
  
  return UI.createElement('div', { className: `form-group ${className}` }, [
    label && UI.createElement('label', { 
      htmlFor: id, 
      className: `form-label ${labelClassName}` 
    }, label),
    
    UI.createElement('input', {
      type,
      id,
      name,
      value,
      className: `form-control ${inputClassName} ${error ? 'is-invalid' : ''}`,
      placeholder,
      onChange: (e) => onChange && onChange(e.target.value, e),
      ...rest
    }),
    
    helpText && !error && UI.createElement('div', { 
      className: 'form-text text-muted' 
    }, helpText),
    
    error && UI.createElement('div', { 
      className: 'invalid-feedback' 
    }, error)
  ].filter(Boolean));
});

// Alert Component
UI.register('Alert', ({
  message,
  type = 'info',
  dismissible = true,
  onDismiss,
  className = ''
} = {}) => {
  const alert = UI.createElement('div', {
    className: `alert alert-${type} ${dismissible ? 'alert-dismissible fade show' : ''} ${className}`,
    role: 'alert'
  }, [
    message,
    dismissible && UI.createElement('button', {
      type: 'button',
      className: 'btn-close',
      'data-bs-dismiss': 'alert',
      'aria-label': 'Close',
      onClick: onDismiss
    })
  ].filter(Boolean));

  return alert;
});

// Loading Spinner Component
UI.register('Spinner', ({
  size = 'md',
  variant = 'primary',
  className = '',
  showText = false,
  text = 'Loading...'
} = {}) => {
  const sizes = {
    sm: 'spinner-border-sm',
    md: '',
    lg: 'spinner-border-lg'
  };

  return UI.createElement('div', { 
    className: `d-flex align-items-center ${className}`,
    role: 'status'
  }, [
    UI.createElement('div', { 
      className: `spinner-border text-${variant} ${sizes[size] || ''} me-2`,
      role: 'status'
    }, [
      UI.createElement('span', { className: 'visually-hidden' }, 'Loading...')
    ]),
    showText && text
  ].filter(Boolean));
});

// Tabs Component
UI.register('Tabs', ({
  tabs = [],
  activeTab = 0,
  onTabChange,
  className = '',
  navClassName = 'nav-tabs',
  contentClassName = 'p-3 border border-top-0 rounded-bottom',
  ...rest
} = {}) => {
  const [currentTab, setCurrentTab] = React.useState(activeTab);
  
  const handleTabChange = (index) => {
    setCurrentTab(index);
    if (onTabChange) onTabChange(index);
  };

  return UI.createElement('div', { className: `tabs-container ${className}`, ...rest }, [
    // Tab Navigation
    UI.createElement('ul', { 
      className: `nav ${navClassName} mb-0`,
      role: 'tablist'
    }, tabs.map((tab, index) => {
      const isActive = index === currentTab;
      return UI.createElement('li', { 
        key: tab.id || index,
        className: 'nav-item',
        role: 'presentation'
      }, [
        UI.createElement('button', {
          className: `nav-link ${isActive ? 'active' : ''}`,
          id: `tab-${tab.id || index}`,
          'data-bs-toggle': 'tab',
          'data-bs-target': `#tab-content-${tab.id || index}`,
          type: 'button',
          role: 'tab',
          'aria-controls': `tab-content-${tab.id || index}`,
          'aria-selected': isActive,
          onClick: () => handleTabChange(index)
        }, [
          tab.icon && UI.createElement('i', { 
            className: `me-2 ${tab.icon}` 
          }),
          tab.label
        ].filter(Boolean))
      ]);
    })),
    
    // Tab Content
    UI.createElement('div', { className: 'tab-content' }, [
      tabs.map((tab, index) => {
        const isActive = index === currentTab;
        return UI.createElement('div', {
          key: `content-${tab.id || index}`,
          className: `tab-pane fade ${isActive ? 'show active' : ''} ${contentClassName}`,
          id: `tab-content-${tab.id || index}`,
          role: 'tabpanel',
          'aria-labelledby': `tab-${tab.id || index}`
        }, isActive ? tab.content : null);
      })
    ])
  ]);
}, true); // Singleton component

// Export the UI instance
export default UI;
