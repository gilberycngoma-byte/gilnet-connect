export type StaffRecipient = {
  id: string;
  name: string;
  department: string;
};

type ProfileRow = {
  id: string;
  name: string;
};

type RoleRow = {
  user_id: string;
};

export function isMissingStaffMembersTable(error: { code?: string }) {
  return error.code === "PGRST205";
}

export function recipientsFromProfiles(
  profiles: ProfileRow[],
  roles: RoleRow[],
  currentUserId: string,
): StaffRecipient[] {
  const propertyUserIds = new Set(roles.map((role) => role.user_id));

  return profiles
    .filter((profile) => profile.id !== currentUserId && propertyUserIds.has(profile.id))
    .map((profile) => ({
      id: profile.id,
      name: profile.name.trim() || "Staff member",
      department: "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
