import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../services/api';
import { adminRouteFor, NOTIFS_READ, NOTIFS_NEW } from '../../utils/adminNotifRoute';
import { WorkQueue } from '../../components/admin/AdminWorkQueue';
import AchieverNotifications from '../achiever/AchieverNotifications';

const announceRead = () => window.dispatchEvent(new Event(NOTIFS_READ));

/** Everything achievers have sent the admin, plus what is still waiting. */
export default function AdminNotifications() {
  // A notification can be read while the work is still undone, so the live
  // queues sit above the list.
  const [queue, setQueue] = useState(null);
  const loadQueue = useCallback(() => {
    adminApi.get('/skovo-platform-panel-admin/dashboard-summary')
      .then(({ data }) => { if (data?.bool) setQueue(data.response); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadQueue();
    window.addEventListener(NOTIFS_NEW, loadQueue);
    return () => window.removeEventListener(NOTIFS_NEW, loadQueue);
  }, [loadQueue]);

  return (
    <AchieverNotifications
      client={adminApi}
      routeFor={adminRouteFor}
      onReadChange={announceRead}
      refreshEvent={NOTIFS_NEW}
      className="p-4 sm:p-6 lg:p-8"
      emptyText="Achiever verification, payout and support requests land here."
      top={queue ? <WorkQueue queues={queue.queues} total={queue.needs_attention} /> : null}
    />
  );
}
