// toast.js
const style = document.createElement('style');
style.innerHTML = `
.toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    z-index: 9999;
    pointer-events: none;
}
.toast {
    background: var(--surface-raised, #161d33);
    border: 1px solid var(--border, #232b42);
    color: var(--text, #e8ecf5);
    font-family: 'Inter', sans-serif;
    font-size: 13.5px;
    padding: 12px 18px;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    gap: 12px;
    transform: translateX(120%);
    opacity: 0;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
    pointer-events: auto;
}
.toast.show {
    transform: translateX(0);
    opacity: 1;
}
.toast-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    flex-shrink: 0;
}
.toast.success .toast-icon { background: rgba(63, 191, 127, 0.15); color: var(--up, #3fbf7f); }
.toast.error .toast-icon { background: rgba(255, 92, 108, 0.15); color: var(--down, #ff5c6c); }
.toast.info .toast-icon { background: rgba(224, 164, 88, 0.15); color: var(--accent, #e0a458); }
`;
document.head.appendChild(style);

const container = document.createElement('div');
container.className = 'toast-container';
document.body.appendChild(container);

window.showToast = function(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconSvg = '';
    if (type === 'success') {
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else {
        iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `
        <div class="toast-icon">${iconSvg}</div>
        <div>${message}</div>
    `;
    
    container.appendChild(toast);
    
    // trigger reflow
    toast.offsetHeight;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};
