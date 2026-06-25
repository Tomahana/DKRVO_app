import './style.css'
import { renderImportJimp } from './modules/import-obd/ImportJimp'
import './modules/import-obd/importJimp.css'

const app = document.querySelector<HTMLDivElement>('#app')!
renderImportJimp(app)
