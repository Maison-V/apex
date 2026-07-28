import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

const ONLINE_WINDOW_MS = 3 * 60 * 1000
const REFRESH_MS = 15000

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS
}

function formatWhen(value) {
  if (!value) return 'Never'
  return new Date(value).toLocaleString()
}

export default function AdminDashboard() {
  const { profile: me, signOut } = useAuth()
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const emailActionResult = searchParams.get('result')

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (err) {
      setError(err.message)
    } else {
      setError('')
      setRows(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => clearInterval(interval)
  }, [load])

  const act = async (id, newStatus) => {
    setBusyId(id)
    const { error: err } = await supabase.rpc('set_account_status', {
      target_id: id,
      new_status: newStatus,
    })
    if (err) setError(err.message)
    await load()
    setBusyId(null)
  }

  const pending = rows.filter((r) => r.status === 'pending')
  const approved = rows.filter((r) => r.status === 'approved')
  const online = rows.filter((r) => isOnline(r.last_seen_at))

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <BrandMark />
        <div className="admin-header-right">
          <Link to="/">
            <button type="button" className="nav-item">Back to dashboard</button>
          </Link>
          <button type="button" className="signout-btn" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="admin-body">
        <h1>Access control</h1>
        <p className="admin-subtitle">
          Signed in as CEO — {me?.full_name || me?.email}. You're the only account that can approve,
          reject, or manage members.
        </p>

        {emailActionResult && (
          <div className={emailActionResult === 'ok' ? 'form-notice' : 'form-error'}>
            {emailActionResult === 'ok'
              ? 'Action completed from your email link.'
              : 'That email link was invalid or expired — use the table below instead.'}
          </div>
        )}

        <div className="admin-stats">
          <div className="admin-stat"><span>{pending.length}</span>Pending requests</div>
          <div className="admin-stat"><span>{approved.length}</span>Approved members</div>
          <div className="admin-stat"><span>{online.length}</span>Currently online</div>
        </div>

        {error && <div className="form-error">{error}</div>}

        {pending.length > 0 && (
          <section className="admin-section">
            <h2>Pending requests</h2>
            <table className="admin-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Requested</th><th /></tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id}>
                    <td>{r.full_name || '—'}</td>
                    <td>{r.email}</td>
                    <td>{formatWhen(r.created_at)}</td>
                    <td className="admin-actions">
                      <button
                        type="button"
                        className="btn-accent"
                        disabled={busyId === r.id}
                        onClick={() => act(r.id, 'approved')}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={busyId === r.id}
                        onClick={() => act(r.id, 'rejected')}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="admin-section">
          <h2>All accounts</h2>
          {loading ? (
            <p className="text-muted">Loading…</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr><th /><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last seen</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span
                        className={`status-dot${isOnline(r.last_seen_at) ? ' online' : ''}`}
                        title={isOnline(r.last_seen_at) ? 'Online now' : 'Offline'}
                      />
                    </td>
                    <td>{r.full_name || '—'}</td>
                    <td>{r.email}</td>
                    <td>{r.role === 'ceo' ? 'CEO' : 'Member'}</td>
                    <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                    <td>{formatWhen(r.last_seen_at)}</td>
                    <td className="admin-actions">
                      {r.role !== 'ceo' && r.status === 'pending' && (
                        <button type="button" className="btn-accent" disabled={busyId === r.id} onClick={() => act(r.id, 'approved')}>
                          Approve
                        </button>
                      )}
                      {r.role !== 'ceo' && r.status === 'approved' && (
                        <button type="button" className="btn-danger" disabled={busyId === r.id} onClick={() => act(r.id, 'rejected')}>
                          Revoke
                        </button>
                      )}
                      {r.role !== 'ceo' && r.status === 'rejected' && (
                        <button type="button" className="btn-accent" disabled={busyId === r.id} onClick={() => act(r.id, 'approved')}>
                          Reinstate
                        </button>
                      )}
                      {r.role === 'ceo' && <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
