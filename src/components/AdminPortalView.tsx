import React from 'react';

interface AdminPortalViewProps {
  language?: string;
}

export const AdminPortalView: React.FC<AdminPortalViewProps> = () => {
  return (
    <div className="fixed inset-0 w-screen h-screen bg-[#0a0d14] z-[9999] overflow-hidden flex flex-col">
      <iframe
        src="/api/admin/portal-html"
        title="Admin Management Portal"
        className="w-full h-full border-0 flex-1"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
      />
    </div>
  );
};
