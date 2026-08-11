import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';

// Self-service password change — PUT /auth/password, distinct from the
// admin-only POST /admin/users/:id/reset-password (useAdminUsers.ts), which
// sets a peer's password directly with no current-password check.
export function useChangePassword() {
  return useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      await api.put('/auth/password', data);
    },
  });
}
