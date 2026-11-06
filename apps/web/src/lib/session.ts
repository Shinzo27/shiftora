import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { authApi } from './api.js';

const sessionKey = ['session'] as const;

/** The logged-in user: undefined while loading, null when logged out. */
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: authApi.restore,
    staleTime: Infinity,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => queryClient.setQueryData(sessionKey, user),
  });
}

export function useSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.signup,
    onSuccess: (user) => queryClient.setQueryData(sessionKey, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      queryClient.clear(); // drop every cached org's data
      queryClient.setQueryData(sessionKey, null);
    },
  });
}
