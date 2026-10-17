/** Strings (keys `adm.*`). */
export const adminEn = {
  'adm.placeholder': 'Overview',
  'adm.copy': 'Copy',
  'adm.copied': 'Copied',

  // terminals
  'adm.term.subtitle': 'The tills that sign and send your receipts.',
  'adm.term.add': 'Add a terminal',
  'adm.term.keyNow': 'New terminal: copy the key now',
  'adm.term.keyOnce': 'It is shown once. We keep only a fingerprint.',
  'adm.term.col.terminal': 'Terminal',
  'adm.term.lastReceipt': 'Last receipt',
  'adm.term.never': 'Never',
  'adm.term.justNow': 'Just now',
  'adm.term.offlineHint': 'Offline means the till has not been seen for more than 5 minutes.',
  'adm.status.offline': 'offline',

  // locations
  'adm.loc.subtitle': 'Where you sell. Each receipt carries the location it came from.',
  'adm.loc.add': 'Add a location',
  'adm.loc.terminalsOne': '1 terminal',
  'adm.loc.terminalsMany': '{n} terminals',
  'adm.loc.noTerminals': 'No terminals',
  'adm.loc.save': 'Save location',
  'adm.loc.namePlaceholder': 'Name of the shop or site',
  'adm.loc.addressPlaceholder': 'Street and number',

  // users
  'adm.users.title': 'Users and roles',
  'adm.users.subtitle': 'Who can see what in the dashboard.',
  'adm.users.invite': 'Invite a user',
  'adm.users.owner': 'Everything, including users, setup and receipt design.',
  'adm.users.manager': 'Reports, archive, terminals, locations and design. No users or setup.',
  'adm.users.accountant': 'Read-only reports, archive and exports. Nothing else.',
  'adm.users.person': 'Person',
  'adm.users.twoStep': 'Two-step code',
  'adm.users.changeRole': 'Change role',
  'adm.users.resetCode': 'Reset code',

  // setup
  'adm.setup.stepCountry': 'Country',
  'adm.setup.stepIdentity': 'Identity',
  'adm.setup.stepLegal': 'Legal settings',
  'adm.setup.stepConfirm': 'Confirm',
  'adm.setup.stepsLabel': 'Setup steps',
  'adm.setup.lawCard': 'What the law says',
  'adm.setup.settingsRequired': 'Required settings are marked.',
  'adm.setup.sourcesTitle': 'Sources and what your adviser must verify',

  // designer
  'adm.design.selected': 'Selected: {type}',

  // simulator
  'adm.sim.subtitle': 'A browser till for demos. Issue a receipt and scan the code with the wallet.',
  'adm.sim.copyLink': 'Copy link',
  'adm.sim.openWallet': 'Open in wallet',
  'adm.sim.notIssued': 'Not issued yet',
} as const satisfies Record<string, string>;
