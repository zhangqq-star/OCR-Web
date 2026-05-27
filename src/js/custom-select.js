const CustomSelect = (() => {
  class Select {
    constructor(el) {
      this.el = el;
      this.isOpen = false;
      this._build();
      this.sync();
      this._observe();
      this._bindGlobal();
    }

    _build() {
      this.el.style.display = 'none';
      this.el.tabIndex = -1;

      this.wrapper = document.createElement('div');
      this.wrapper.className = 'custom-select';

      this.header = document.createElement('div');
      this.header.className = 'custom-select-header';
      this.header.innerHTML = '<span class="custom-select-text"></span><span class="custom-select-arrow"></span>';

      this.dropdown = document.createElement('div');
      this.dropdown.className = 'custom-select-dropdown hidden';

      this.wrapper.appendChild(this.header);
      this.wrapper.appendChild(this.dropdown);
      this.el.parentNode.insertBefore(this.wrapper, this.el.nextSibling);

      this.textEl = this.header.querySelector('.custom-select-text');

      this.header.addEventListener('click', () => this.toggle());
    }

    _observe() {
      this._observer = new MutationObserver(() => this.sync());
      this._observer.observe(this.el, { childList: true, subtree: true, characterData: true });
    }

    _bindGlobal() {
      document.addEventListener('click', e => {
        if (this.isOpen && !this.wrapper.contains(e.target)) this.close();
      });
    }

    sync() {
      const opts = Array.from(this.el.options);
      this.dropdown.innerHTML = opts.map(o =>
        `<div class="custom-select-option${o.selected ? ' active' : ''}" data-value="${o.value}">${o.textContent}</div>`
      ).join('');

      this.textEl.textContent = this.el.selectedIndex >= 0 ? opts[this.el.selectedIndex].textContent : '';

      this.dropdown.querySelectorAll('.custom-select-option').forEach(div => {
        div.addEventListener('click', () => {
          this.el.value = div.dataset.value;
          this.textEl.textContent = div.textContent;
          this.dropdown.querySelectorAll('.custom-select-option').forEach(d => d.classList.remove('active'));
          div.classList.add('active');
          this.close();
          this.el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }

    toggle() { this.isOpen ? this.close() : this.open(); }

    open() {
      this.isOpen = true;
      this.dropdown.classList.remove('hidden');
      this.header.classList.add('open');
    }

    close() {
      this.isOpen = false;
      this.dropdown.classList.add('hidden');
      this.header.classList.remove('open');
    }
  }

  const instances = new Map();

  function init(el) {
    if (instances.has(el)) return instances.get(el);
    const inst = new Select(el);
    instances.set(el, inst);
    return inst;
  }

  function initAll() {
    document.querySelectorAll('.batch-shelf-select').forEach(el => init(el));
  }

  return { init, initAll, instances };
})();
