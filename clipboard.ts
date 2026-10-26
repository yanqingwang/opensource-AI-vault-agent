import { setIcon } from 'obsidian';

/**
 * Copy text from a chat bubble.
 *
 * Obsidian's renderer is a secure context (`app://obsidian.md`), so the async
 * clipboard API is always available; there is no `execCommand` fallback because
 * that path is deprecated and needs an off-screen textarea positioned with
 * inline styles.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/**
 * Attach a copy button to a message. `getText` is called on click so a bubble
 * that is still streaming copies what the reader sees at that moment. The icon
 * flips to a check for a moment instead of raising a notice, so clicking never
 * covers the answer.
 */
export function addCopyButton(
	parent: HTMLElement,
	getText: () => string,
	labels: { copy: string; copied: string; failed: string }
): HTMLButtonElement {
	const btn = parent.createEl('button', { cls: 'va-copy-btn', attr: { 'aria-label': labels.copy, title: labels.copy } });
	setIcon(btn, 'copy');
	const relabel = (text: string) => {
		btn.setAttribute('aria-label', text);
		btn.setAttribute('title', text);
	};
	btn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		void copyText(getText()).then(ok => {
			setIcon(btn, ok ? 'check' : 'x');
			relabel(ok ? labels.copied : labels.failed);
			btn.addClass(ok ? 'va-copy-ok' : 'va-copy-fail');
			window.setTimeout(() => {
				setIcon(btn, 'copy');
				relabel(labels.copy);
				btn.removeClass('va-copy-ok');
				btn.removeClass('va-copy-fail');
			}, 1200);
		});
	});
	return btn;
}
