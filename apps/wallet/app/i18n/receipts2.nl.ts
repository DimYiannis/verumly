/** Dutch strings (keys `rcpt.*`). Source dictionary for these keys. */
export const receipts2Nl = {
  'rcpt.placeholder': 'Bonnen',

  // receipts list
  'rcpt.list.title': 'Bonnen',
  'rcpt.list.chipAll': 'Alles',
  'rcpt.list.chipPaid': 'Betaald',
  'rcpt.list.chipShared': 'Gedeeld',
  'rcpt.list.chipCancelled': 'Geannuleerd',
  'rcpt.list.sharedWith': 'gedeeld met {names}',
  'rcpt.list.from': 'van {name}',
  'rcpt.list.noResults': 'Geen resultaten',
  'rcpt.list.clearFilters': 'Filters wissen',

  // receipt page
  'rcpt.detail.stillOpen': 'Nog open',
  'rcpt.detail.allSettled': 'Alles verrekend',
  'rcpt.detail.owesYou': '{names} moet jou nog betalen',
  'rcpt.detail.youOweCreator': 'Je moet {name} nog betalen',
  'rcpt.detail.nothingOwed': 'Niemand hoeft nog te betalen',
  'rcpt.detail.paidAll': 'Alles betaald',
  'rcpt.detail.settled': 'Betaald',
  'rcpt.detail.youOwe': 'Jij betaalt',
  'rcpt.detail.owesYouBadge': 'Betaalt jou',
  'rcpt.detail.owes': 'Open',
  'rcpt.detail.markSettled': 'Markeer {name} als betaald',
  'rcpt.detail.whatEach': 'Wat iedereen had',
  'rcpt.detail.editSplit': 'Verdeling bekijken',
  'rcpt.detail.equalShare': 'Een gelijk deel',
  'rcpt.detail.mode.equal': 'Gelijk verdeeld, afrondingsverschil naar de eerste persoon.',
  'rcpt.detail.mode.items': 'Verdeeld per product, fooi en afronding naar verhouding.',
  'rcpt.detail.mode.custom': 'Bedragen met de hand ingevuld.',
  'rcpt.detail.vatLine': 'Inclusief {vat} btw',
  'rcpt.detail.splitThis': 'Rekening splitsen',
  'rcpt.detail.paper': 'Bekijk de papieren bon',
  'rcpt.detail.paperHint': 'Regels, btw en betaling',

  // friends
  'rcpt.friends.add': 'Toevoegen',
  'rcpt.friends.activity': 'Activiteit',
  'rcpt.friends.noActivity': 'Nog geen activiteit. Deel een bon of splits een rekening.',
  'rcpt.act.friendAdded': '{name} is nu je vriend',
  'rcpt.act.friendRequest': '{name} wil je vriend zijn',
  'rcpt.act.wantsFriend': 'wil je vriend zijn',
  'rcpt.act.shareReceived': '{name} deelde een bon',
  'rcpt.act.splitWithMe': '{name} splitste {merchant} met jou',
  'rcpt.act.splitCreated': 'Jij splitste {merchant}',
  'rcpt.act.paidYou': '{name} betaalde je terug: {amount}',
  'rcpt.act.youSettled': 'Jij betaalde {name} terug: {amount}',
  'rcpt.act.reaction': '{emoji} {name} reageerde op {merchant}',
  'rcpt.act.stillOpen': 'nog {amount} open',
  'rcpt.act.yourShare': 'jouw deel {amount}',

  // split a bill
  'rcpt.split.withWhom': 'Met wie',
  'rcpt.split.eachPays': 'Ieder betaalt',
  'rcpt.split.privacy': 'Je vrienden zien de producten en het totaal van deze bon. Niets anders.',

  // split page
  'rcpt.sd.openOfTotal': 'van {total} nog open',
  'rcpt.sd.openReceipt': 'Naar de bon',
  'rcpt.sd.deleteNote': 'Als je de verdeling verwijdert, ziet niemand hem meer.',
  'rcpt.sd.paidBill': 'Betaalde de rekening',
  'rcpt.sd.settledWhen': 'Betaald {when}',
  'rcpt.sd.guestWaiting': 'Nog niet aangesloten',

  // shared receipt
  'rcpt.shared.title': 'Met jou gedeeld',
  'rcpt.shared.askToSplit': 'Wil je de rekening splitsen? Vraag {name} om je toe te voegen.',

  // invite
  'rcpt.invite.joinTitle': 'Aansluiten met een code',
  'rcpt.invite.joinHint': 'Scan de QR-code bij de kassa of van een vriend',
  'rcpt.invite.scan': 'Scan',
} as const satisfies Record<string, string>;
