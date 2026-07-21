import BrandMark from './BrandMark'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { id: 'dashboard', label: 'Market dashboard', section: 'Overview' },
  { id: 'hft', label: 'HFT Console', section: 'Trading' },
  { id: 'ldp', label: 'Last Digit Predictor', section: 'Trading' },
]

export default function Sidebar({ currentView, onViewChange }) {
  const { signOut } = useAuth()
  let lastSection = ''

  return (
    <aside className="sidebar">
      <BrandMark />

      {NAV.map((item) => {
        const showSection = item.section !== lastSection
        lastSection = item.section
        return (
          <div key={item.id}>
            {showSection && <div className="nav-section-label">{item.section}</div>}
            <button
              type="button"
              className={`nav-item${item.id === currentView ? ' active' : ''}`}
              onClick={() => onViewChange(item.id)}
              aria-current={item.id === currentView ? 'page' : undefined}
            >
              {item.label}
            </button>
          </div>
        )
      })}

      <div className="sidebar-footer">
        <button className="signout-btn" onClick={signOut} type="button">
          Sign out
        </button>
      </div>
    </aside>
  )
}
