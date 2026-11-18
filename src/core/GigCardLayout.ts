/**
 * Fit the live copy into the cream part of the illustrated gig card.
 * CSS owns the positioning and normal wrapping; this only reduces font sizes
 * when a long objective/progress line would exceed its available space.
 */
export function fitGigCardText(card: HTMLElement): void {
  const paper = card.querySelector<HTMLElement>('.gg-gig-paper');
  const title = card.querySelector<HTMLElement>('.gg-gig-title');
  const task = card.querySelector<HTMLElement>('.gg-gig-task');
  const detail = card.querySelector<HTMLElement>('.gg-gig-detail');
  const footer = card.querySelector<HTMLElement>('.gg-gig-footer');
  const wallet = card.querySelector<HTMLElement>('.gg-gig-wallet');
  const mode = card.querySelector<HTMLElement>('[data-mode]');
  if (!paper || !title || !task || !detail || !footer || !wallet || !mode ||
    !paper.clientHeight) return;

  // A new objective, mode or viewport width must start at the designed sizes.
  for (const element of [title, task, detail, footer]) {
    element.style.removeProperty('font-size');
  }

  // Portrait uses normal flow with a reserved footer. Do not shrink its type
  // or force two long footer labels onto the same line.
  if (getComputedStyle(paper).position !== 'absolute') return;

  const shrink = (element: HTMLElement, minimum: number): boolean => {
    const current = Number.parseFloat(getComputedStyle(element).fontSize);
    if (!Number.isFinite(current) || current <= minimum + 0.05) return false;
    element.style.fontSize = Math.max(minimum, current - 0.5).toFixed(2) + 'px';
    return true;
  };
  const fits = (): boolean => paper.scrollHeight <= paper.clientHeight + 1 &&
    [title, task, detail].every(element =>
      element.scrollWidth <= element.clientWidth + 1 &&
      element.scrollHeight <= element.clientHeight + 1);

  // Shrink the objective first, then the hint and small heading. This keeps
  // the important action largest without letting it push the hint off the card.
  for (let i = 0; i < 64 && !fits(); i++) {
    if (shrink(task, 8)) continue;
    if (shrink(detail, 7)) continue;
    if (shrink(title, 8)) continue;
    break;
  }

  // Coin balance and mode must share a single bottom line with a real gap.
  for (let i = 0; i < 20; i++) {
    if (wallet.getBoundingClientRect().right + 4 <= mode.getBoundingClientRect().left &&
      footer.scrollWidth <= footer.clientWidth + 1) break;
    if (!shrink(footer, 7)) break;
  }
}
