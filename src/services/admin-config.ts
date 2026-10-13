export const OWNER_EMAILS = [
  'awoyinfasolomon1@gmail.com',
  'bolttradeverifyonce@gmail.com',
  'awoyinfasunday40@gmail.com',
  'awoyinfataiwo20@gmail.com',
];

export const isOwnerEmail = (email?: string | null): boolean => {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  const envEmails = typeof process !== 'undefined' && process.env?.OWNER_EMAILS
    ? process.env.OWNER_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];
  return OWNER_EMAILS.includes(clean) || envEmails.includes(clean);
};

export const OWNER_EMAIL = 'awoyinfasolomon1@gmail.com';
