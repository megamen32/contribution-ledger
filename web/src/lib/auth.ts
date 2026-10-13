import { getServerSession } from "next-auth"
import { authOptions } from "./auth-options"
import { cookies, headers } from "next/headers"
import { PROJECT_COOKIE, selectedProject, resolveProjectUser } from "./project-membership"

export async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const uid = (session?.user as any)?.id
  if (!uid) return null
  const jar = await cookies()
  const user = await resolveProjectUser(String(uid), selectedProject(jar.get(PROJECT_COOKIE)?.value, String(uid)))
  // An older page must not post its pending work into a newly selected project.
  const expectedProject = (await headers()).get("x-vklad-project")
  return expectedProject && user?.workspaceId !== expectedProject ? null : user
}
