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
            <div
              className={`nav-item${item.id === currentView ? ' active' : ''}`}
              onClick={() => onViewChange(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onViewChange(item.id) }}
            >
              {item.label}
            </div>
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
