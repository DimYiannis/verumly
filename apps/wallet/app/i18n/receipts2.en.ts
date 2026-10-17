import type { receipts2Nl } from './receipts2.nl.ts';

/** English strings, typed against the Dutch key set. */
export const receipts2En: Record<keyof typeof receipts2Nl, string> = {
  'rcpt.placeholder': 'Receipts',

  // receipts list
  'rcpt.list.title': 'Receipts',
  'rcpt.list.chipAll': 'All',
  'rcpt.list.chipPaid': 'Paid',
  'rcpt.list.chipShared': 'Shared',
  'rcpt.list.chipCancelled': 'Cancelled',
  'rcpt.list.sharedWith': 'shared with {names}',
  'rcpt.list.from': 'from {name}',
  'rcpt.list.noShared': 'No shared receipts found.',

  // receipt page
  'rcpt.detail.stillOpen': 'Still open',
  'rcpt.detail.allSettled': 'All settled',
  'rcpt.detail.owesYou': '{names} still owes you',
  'rcpt.detail.youOweCreator': 'You still owe {name}',
  'rcpt.detail.nothingOwed': 'Nobody has to pay any more',
  'rcpt.detail.paidAll': 'Paid it all',
  'rcpt.detail.settled': 'Paid',
  'rcpt.detail.youOwe': 'You owe',
  'rcpt.detail.owesYouBadge': 'Owes you',
  'rcpt.detail.owes': 'Open',
  'rcpt.detail.markSettled': 'Mark {name} as settled',
  'rcpt.detail.whatEach': 'What each person had',
  'rcpt.detail.editSplit': 'View split',
  'rcpt.detail.equalShare': 'An equal share',
  'rcpt.detail.mode.equal': 'Equal split, rounding goes to the first person.',
  'rcpt.detail.mode.items': 'Split by item, tip and rounding in proportion.',
  'rcpt.detail.mode.custom': 'Amounts entered by hand.',
  'rcpt.detail.vatLine': 'Includes {vat} VAT',
  'rcpt.detail.splitThis': 'Split this bill',
  'rcpt.detail.paper': 'Open the paper receipt',
  'rcpt.detail.paperHint': 'Lines, VAT and payment',

  // friends
  'rcpt.friends.add': 'Add',
  'rcpt.friends.activity': 'Activity',
  'rcpt.friends.noActivity': 'No activity yet. Share a receipt or split a bill.',
  'rcpt.act.friendAdded': '{name} is now your friend',
  'rcpt.act.friendRequest': '{name} wants to be your friend',
  'rcpt.act.wantsFriend': 'wants to be your friend',
  'rcpt.act.shareReceived': '{name} shared a receipt',
  'rcpt.act.splitWithMe': '{name} split {merchant} with you',
  'rcpt.act.splitCreated': 'You split {merchant}',
  'rcpt.act.paidYou': '{name} paid you back {amount}',
  'rcpt.act.youSettled': 'You paid {name} back {amount}',
  'rcpt.act.reaction': '{emoji} {name} reacted to {merchant}',
  'rcpt.act.stillOpen': '{amount} still open',
  'rcpt.act.yourShare': 'your share {amount}',

  // split a bill
  'rcpt.split.withWhom': 'With whom',
  'rcpt.split.eachPays': 'Each pays',
  'rcpt.split.privacy': 'Your friends will see the items and total of this receipt. Nothing else.',

  // split page
  'rcpt.sd.openOfTotal': 'of {total} still open',
  'rcpt.sd.openReceipt': 'Open receipt',
  'rcpt.sd.deleteNote': 'Deleting this split removes access for everyone.',
  'rcpt.sd.paidBill': 'Paid the bill',
  'rcpt.sd.settledWhen': 'Settled {when}',
  'rcpt.sd.guestWaiting': 'Has not joined yet',

  // shared receipt
  'rcpt.shared.title': 'Shared with you',
  'rcpt.shared.askToSplit': 'Want to split it? Ask {name} to add you.',

  // invite
  'rcpt.invite.joinTitle': 'Join with a code',
  'rcpt.invite.joinHint': 'Scan a QR code or read an NFC tag from a friend',
  'rcpt.invite.scan': 'Scan',
};
