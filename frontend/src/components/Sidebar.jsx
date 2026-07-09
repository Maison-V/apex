import BrandMark from './BrandMark'
import { useAuth } from '../context/AuthContext'

export default function Sidebar() {
  const { signOut } = useAuth()

  return (
    <aside className="sidebar">
      <BrandMark />

      <div className="nav-section-label">Overview</div>
      <div className="nav-item active">Market dashboard</div>

      <div className="nav-section-label">Coverage</div>
      <div className="nav-item">Crypto</div>
      <div className="nav-item">Forex</div>
      <div className="nav-item">Equities</div>

      <div className="nav-section-label">Analysis</div>
      <div className="nav-item">Technicals</div>
      <div className="nav-item">Fundamentals</div>
      <div className="nav-item">Market movers</div>

      <div className="sidebar-footer">
        <button className="signout-btn" onClick={signOut} type="button">
          Sign out
        </button>
      </div>
    </aside>
  )
}
