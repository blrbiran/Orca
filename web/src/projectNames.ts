/** Project registry spec §7: one place every section asks how to show a project key. */
import { createContext, useContext } from "react";

export const ProjectNames = createContext<(key: string) => string>((key) => key);
export const useProjectName = (): ((key: string) => string) => useContext(ProjectNames);
