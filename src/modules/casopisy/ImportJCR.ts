export function renderImportJCR(container: HTMLElement): void {
  container.innerHTML = `
    <div class="import-wrap">
      <h2>Časopisy – resetováno</h2>
      <p class="import-hint">
        Všechna předchozí nastavení modulu Časopisy byla odebrána.
        Pro restart databáze spusť SQL skript <code>sql/reset_casopisy.sql</code>.
      </p>
      <div class="import-chyby" style="color:#9ca3af;border-color:#2a2f3d;background:#111827;">
        Modul je nyní v čistém stavu. Další import/výpočty nastavíme od začátku.
      </div>
    </div>
  `
}
