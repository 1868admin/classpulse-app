const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof']);

function cleanParts(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

export function staffDisplayName(member, user) {
  const memberName = cleanParts(member?.full_name);
  const storedTitle = String(member?.title || member?.salutation || '').trim();
  const parsedTitle = TITLES.has((memberName[0] || '').replace(/\.$/, '').toLowerCase())
    ? memberName.shift()
    : '';
  const title = storedTitle || parsedTitle;
  const firstName = String(member?.first_name || user?.first_name || '').trim();
  const lastName = String(member?.last_name || member?.surname || user?.last_name || user?.surname || '').trim();
  const profileName = [firstName, lastName].filter(Boolean).join(' ');
  const memberRemainder = memberName.join(' ');
  const userName = cleanParts(user?.full_name)
    .filter((part) => !TITLES.has(part.replace(/\.$/, '').toLowerCase()))
    .join(' ');
  const name = profileName || memberRemainder || userName;
  if (!name) return '';
  return title ? `${title.replace(/\.?$/, '.') } ${name}` : name;
}

export function staffGreetingName(member, user) {
  const fullName = staffDisplayName(member, user);
  if (!fullName) return 'there';
  const parts = cleanParts(fullName);
  const first = (parts[0] || '').replace(/\.$/, '').toLowerCase();
  if (TITLES.has(first) && parts.length > 1) return `${parts[0]} ${parts.at(-1)}`;
  return fullName;
}
