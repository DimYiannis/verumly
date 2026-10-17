import type { adminEn } from './admin.en';

/** Dutch strings, typed against the English key set. */
export const adminNl: Record<keyof typeof adminEn, string> = {
  'adm.placeholder': 'Overzicht',
  'adm.copy': 'Kopieer',
  'adm.copied': 'Gekopieerd',

  'adm.term.subtitle': 'De kassa\'s die je bonnen ondertekenen en versturen.',
  'adm.term.add': 'Kassa toevoegen',
  'adm.term.keyNow': 'Nieuwe kassa: kopieer nu de sleutel',
  'adm.term.keyOnce': 'Hij wordt maar één keer getoond. Wij bewaren alleen een vingerafdruk.',
  'adm.term.col.terminal': 'Kassa',
  'adm.term.lastReceipt': 'Laatste bon',
  'adm.term.never': 'Nooit',
  'adm.term.justNow': 'Zojuist',
  'adm.term.offlineHint': 'Offline betekent dat de kassa langer dan 5 minuten niet is gezien.',
  'adm.status.offline': 'offline',

  'adm.loc.subtitle': 'Waar je verkoopt. Elke bon draagt de locatie waar hij vandaan komt.',
  'adm.loc.add': 'Locatie toevoegen',
  'adm.loc.terminalsOne': '1 kassa',
  'adm.loc.terminalsMany': '{n} kassa\'s',
  'adm.loc.noTerminals': 'Geen kassa\'s',
  'adm.loc.save': 'Locatie opslaan',
  'adm.loc.namePlaceholder': 'Naam van de winkel of vestiging',
  'adm.loc.addressPlaceholder': 'Straat en huisnummer',

  'adm.users.title': 'Gebruikers en rollen',
  'adm.users.subtitle': 'Wie wat ziet in het dashboard.',
  'adm.users.invite': 'Gebruiker uitnodigen',
  'adm.users.owner': 'Alles, inclusief gebruikers, instellingen en bonontwerp.',
  'adm.users.manager': 'Rapporten, archief, kassa\'s, locaties en ontwerp. Geen gebruikers of instellingen.',
  'adm.users.accountant': 'Rapporten, archief en exports, alleen lezen. Verder niets.',
  'adm.users.person': 'Persoon',
  'adm.users.twoStep': 'Tweestapscode',
  'adm.users.changeRole': 'Rol wijzigen',
  'adm.users.resetCode': 'Code resetten',

  'adm.setup.stepCountry': 'Land',
  'adm.setup.stepIdentity': 'Identiteit',
  'adm.setup.stepLegal': 'Wettelijke instellingen',
  'adm.setup.stepConfirm': 'Bevestigen',
  'adm.setup.stepsLabel': 'Stappen van de instelling',
  'adm.setup.lawCard': 'Wat de wet zegt',
  'adm.setup.settingsRequired': 'Verplichte instellingen zijn gemarkeerd.',
  'adm.setup.sourcesTitle': 'Bronnen en wat je adviseur moet controleren',

  'adm.design.selected': 'Geselecteerd: {type}',

  'adm.sim.subtitle': 'Een kassa in de browser voor demo\'s. Geef een bon uit en scan de code met de wallet.',
  'adm.sim.copyLink': 'Kopieer link',
  'adm.sim.openWallet': 'Open in wallet',
  'adm.sim.notIssued': 'Nog niet uitgegeven',
};
