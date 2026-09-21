export function walletToName(wallet) {
  if (!wallet) return 'anon';
  return wallet.slice(0, 4) + '…' + wallet.slice(-4);
}
export function displayName(user) {
  if (user?.display_name) return user.display_name;
  if (user?.wallet) return walletToName(user.wallet);
  return 'anon';
}
