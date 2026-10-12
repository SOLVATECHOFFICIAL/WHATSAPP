export const OWNER_EMAILS = [
  'awoyinfasolomon1@gmail.com',
  'awoyinfasunday40@gmail.com',
  'awoyinfataiwo20@gmail.com',
];

export const isOwnerEmail = (email?: string | null): boolean => {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return OWNER_EMAILS.includes(clean);
};

export const OWNER_EMAIL = 'awoyinfasolomon1@gmail.com';
