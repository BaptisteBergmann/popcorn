import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@web/components/app_shell';
import { createQueryClient, token } from '@web/lib/api';
import { MemberProvider } from '@web/lib/member';
import { AddPage } from '@web/pages/add_page';
import { ListPage } from '@web/pages/list_page';

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <MemberProvider>
        <BrowserRouter basename={`/${token}`}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<ListPage />} />
              <Route path="add" element={<AddPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MemberProvider>
    </QueryClientProvider>
  );
}
