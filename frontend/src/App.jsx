import { Link, Route, Routes } from 'react-router-dom'
import ProjectListPage from './pages/ProjectListPage.jsx'
import EditorPage from './pages/EditorPage.jsx'
import MergePage from './pages/MergePage.jsx'
import RulesPage from './pages/RulesPage.jsx'
import QualityPage from './pages/QualityPage.jsx'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          🎙️ 访谈音频校注
        </Link>
        <nav>
          <Link to="/">项目</Link>
          <Link to="/merge">三方合并</Link>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<ProjectListPage />} />
          <Route path="/projects/:id" element={<EditorPage />} />
          <Route path="/projects/:id/rules" element={<RulesPage />} />
          <Route path="/projects/:id/quality" element={<QualityPage />} />
          <Route path="/merge" element={<MergePage />} />
        </Routes>
      </main>
    </div>
  )
}
