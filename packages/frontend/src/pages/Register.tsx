import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Mail, Lock, KeyRound } from 'lucide-react';
import { api } from '../lib/api';
import { setAuth } from '../lib/auth';
import { useProjectStore } from '../stores/projectStore';
import { useAuthConfig } from '../hooks/useAuthConfig';
import GoogleAuthButton from '../components/ui/GoogleAuthButton';
import { IconField } from '../components/ui/IconField';
import { AuthLayout } from '../components/layout/AuthLayout';
import type { AuthResponse } from '../types';
import toast from 'react-hot-toast';

const COMPANY_EMAIL_DOMAIN = '@6dtech.co.in';

export default function Register() {
  const navigate = useNavigate();
  const { setCurrentUser } = useProjectStore();
  const { data: authConfig } = useAuthConfig();
  const [name, setName] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleGoogleCredential(credential: string) {
    setGoogleLoading(true);
    try {
      const res = await api.post<AuthResponse>('/auth/google', { credential });
      setAuth(res.data.token, res.data.user);
      setCurrentUser(res.data.user);
      toast.success(`Account ready! Welcome, ${res.data.user.name}.`);
      navigate('/projects', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Google sign-in failed. Please try again.';
      toast.error(msg);
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !emailLocal || !password) {
      toast.error('Please fill in all required fields.');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    const email = `${emailLocal}${COMPANY_EMAIL_DOMAIN}`;
    setLoading(true);
    try {
      const res = await api.post<AuthResponse>('/auth/register', { name, email, password });
      setAuth(res.data.token, res.data.user);
      setCurrentUser(res.data.user);
      toast.success(`Welcome, ${res.data.user.name}! Your account is ready.`);
      navigate('/projects', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Registration failed. Please try again.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="Create account"
      title="Join the team"
      subtitle="Set up your account to get started."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--cyan)', fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <IconField icon={User}>
          <input
            type="text"
            className="input-field"
            placeholder="Your full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
            style={{ fontFamily: 'var(--font-ui)', fontSize: '13.5px', paddingLeft: '36px' }}
          />
        </IconField>

        <IconField icon={Mail}>
          <input
            type="text"
            className="input-field"
            placeholder="yourname"
            value={emailLocal}
            onChange={(e) => setEmailLocal(e.target.value.replace(/\s/g, '').split('@')[0])}
            autoComplete="off"
            required
            style={{ fontFamily: 'var(--font-ui)', fontSize: '13.5px', paddingLeft: '36px' }}
          />
          <span style={{ position: 'absolute', right: '12px', color: 'var(--text-dim)', fontSize: '12px', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>
            {COMPANY_EMAIL_DOMAIN}
          </span>
        </IconField>

        <IconField icon={Lock}>
          <input
            type="password"
            className="input-field"
            placeholder="Min. 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            style={{ fontFamily: 'var(--font-ui)', fontSize: '13.5px', paddingLeft: '36px' }}
          />
        </IconField>

        <IconField icon={KeyRound}>
          <input
            type="password"
            className="input-field"
            placeholder="Repeat password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            style={{ fontFamily: 'var(--font-ui)', fontSize: '13.5px', paddingLeft: '36px' }}
          />
        </IconField>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '12px', marginTop: '4px',
            background: loading ? 'rgba(2,132,199,0.5)' : 'linear-gradient(135deg, #38BDF8, #0284C7)',
            border: 'none', borderRadius: '100px', color: '#fff', fontSize: '14px', fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-ui)', transition: 'opacity 0.15s',
            boxShadow: loading ? 'none' : '0 6px 18px rgba(2,132,199,0.35)',
          }}
        >
          {loading ? 'Creating account…' : 'Create Account'}
        </button>
      </form>

      {authConfig?.googleEnabled && (
        <div style={{ marginTop: '16px', padding: '14px', background: 'var(--cyan-dim)', borderRadius: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border2)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', textTransform: 'uppercase' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border2)' }} />
          </div>

          <GoogleAuthButton
            clientId={authConfig.googleClientId!}
            onCredential={handleGoogleCredential}
            text="signup_with"
            loading={googleLoading}
          />

          {authConfig.allowedDomains.length > 0 && (
            <p style={{ marginTop: 10, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              Restricted to{' '}
              <strong style={{ color: 'var(--cyan)' }}>{authConfig.allowedDomains.join(', ')}</strong>
            </p>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
