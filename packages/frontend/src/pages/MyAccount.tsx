import { useState, type CSSProperties } from 'react';
import toast from 'react-hot-toast';
import Topbar from '../components/layout/Topbar';
import { useProjectStore } from '../stores/projectStore';
import { useChangePassword } from '../hooks/useAccount';
import { getInitials } from '../lib/utils';

const LABEL_STYLE: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '1.2px',
  textTransform: 'uppercase',
  color: 'var(--text-mid)',
  marginBottom: '6px',
};

// ── Change Password — self-service, PUT /auth/password. Distinct from the
// admin-only reset in UserManagement.tsx: this one requires the caller's
// current password, since it's the user changing their own credential
// rather than an admin overriding someone else's. ──────────────────────────
function ChangePasswordCard() {
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);

  function reset() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPw('');
  }

  async function handleSubmit() {
    if (newPassword.length < 8) { toast.error('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPw) { toast.error('Passwords do not match.'); return; }
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      toast.success('Password updated.');
      reset();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      toast.error(axiosErr.response?.data?.error ?? 'Failed to update password.');
    }
  }

  const disabled = !currentPassword || !newPassword || !confirmPw || changePassword.isPending;

  return (
    <div className="card" style={{ padding: 20, maxWidth: 420 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Change Password</div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 18 }}>Update the password you use to sign in.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={LABEL_STYLE}>Current Password</label>
          <input
            className="input-field"
            type={showPw ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Your current password"
            style={{ fontFamily: 'var(--font-mono)', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <label style={LABEL_STYLE}>New Password</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input-field"
              type={showPw ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              style={{ fontFamily: 'var(--font-mono)', paddingRight: 36, width: '100%', boxSizing: 'border-box' }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)', padding: 0 }}
            >{showPw ? '🙈' : '👁'}</button>
          </div>
        </div>
        <div>
          <label style={LABEL_STYLE}>Confirm New Password</label>
          <input
            className="input-field"
            type={showPw ? 'text' : 'password'}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) void handleSubmit(); }}
            placeholder="Repeat new password"
            style={{ fontFamily: 'var(--font-mono)', width: '100%', boxSizing: 'border-box' }}
          />
          {confirmPw && newPassword !== confirmPw && (
            <p style={{ marginTop: 4, fontSize: 10, color: 'var(--fail)', fontFamily: 'var(--font-mono)' }}>Passwords do not match</p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={disabled}
        style={{
          marginTop: 20,
          padding: '9px 18px',
          background: 'linear-gradient(135deg, #F47B20, #D9601A)',
          border: 'none', borderRadius: 6,
          color: '#fff', fontSize: 13, fontWeight: 700,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {changePassword.isPending ? 'Updating…' : 'Update Password'}
      </button>
    </div>
  );
}

export default function MyAccount() {
  const { currentUser } = useProjectStore();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Topbar breadcrumbs={[{ label: 'My Account' }]} />

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid', gridTemplateColumns: '1fr', alignContent: 'start', gap: 20 }}>
        <div>
          <div className="page-eyebrow">Account</div>
          <h1 className="page-title">My Account</h1>
        </div>

        <div className="card" style={{ padding: 20, maxWidth: 420, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--violet), var(--cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}
          >
            {currentUser ? getInitials(currentUser.name) : 'U'}
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{currentUser?.name ?? 'Guest'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{currentUser?.email}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: 3 }}>
              {currentUser?.globalRole?.replace('_', ' ') ?? 'User'}
            </div>
          </div>
        </div>

        <ChangePasswordCard />
      </div>
    </div>
  );
}
