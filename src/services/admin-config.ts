export const OWNER_EMAILS = [
  'awoyinfasolomon1@gmail.com',
];

export const isOwnerEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return email.trim().toLowerCase() === 'awoyinfasolomon1@gmail.com';
};

export const OWNER_EMAIL = 'awoyinfasolomon1@gmail.com';
