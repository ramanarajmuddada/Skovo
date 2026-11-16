// "Use my SKOVO Wallet" at checkout — only when the wallet is on, has money,
// and the admin allows it for this kind of purchase.
import React, { useEffect, useState } from 'react';
import { View, Switch } from 'react-native';
import { T, rupee } from './v1';
import { studentApi } from '../services/api';

export default function WalletToggle({ kind, value, onChange }) {
  const [w, setW] = useState(null);
  useEffect(() => { studentApi.get('/payments/wallet').then(({ data }) => data?.bool && setW(data.response)).catch(() => {}); }, []);
  if (!w?.enabled || !(w.total > 0) || !w.usable_on.includes(kind)) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
      <T>Use my SKOVO Wallet ({rupee(w.total)})</T>
      <Switch value={!!value} onValueChange={onChange} />
    </View>
  );
}
