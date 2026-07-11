import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/users")({
  head: () => ({ meta: [{ title: "User & Role Management · Kpisavvy" }] }),
  component: UsersPage,
});

// In-app user creation/role management is disabled for now — accounts are
// provisioned directly in Supabase (auth.users + public.user_management)
// instead. This is deliberate, not a bug (see H4 in the security review):
// the old admin UI let anyone with the Admin flag set arbitrary temporary
// passwords via supabaseAdmin.auth.admin.createUser with no strength
// check. Disabling it removes that surface entirely until a proper
// version ships. The full original implementation is preserved below,
// commented out, ready to restore.
function UsersPage() {
  return (
    <AppShell>
      <PageHeader
        title="User & Role Management"
        description="Not available in-app yet — accounts are provisioned directly in Supabase for now."
      />
      <PageBody>
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            In-app user creation is coming in a later release.
          </CardContent>
        </Card>
      </PageBody>
    </AppShell>
  );
}

/* ── Disabled pending a future release — restore by uncommenting below,
   swapping UsersPage's body back to the isAdmin-gated version, and
   restoring the imports (createUserAccount, deleteUserAccount, listUsers,
   updateUserFields from "@/lib/user-management.functions"; useAppUser
   from "@/lib/app-user"; type StaffRole from "@/lib/gate.functions"; plus
   useServerFn/useMutation/useQuery/useQueryClient, useNavigate, useEffect,
   useState, and the ui/* components used below) ──

import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { useAppUser } from "@/lib/app-user";
import type { StaffRole } from "@/lib/gate.functions";
import {
  createUserAccount, deleteUserAccount, listUsers, updateUserFields,
} from "@/lib/user-management.functions";

const JOB_ROLES: StaffRole[] = ["BA", "ITPM", "PMO", "Tester"];
const NO_ROLE = "none";

type UserRow = {
  id: string;
  user_name: string;
  email: string;
  is_admin: boolean;
  role: StaffRole | null;
  is_test_case_approver: boolean;
  is_active: boolean;
  created_at: string;
};

function UsersPageGated() {
  const { isAdmin, isLoading } = useAppUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAdmin) navigate({ to: "/" });
  }, [isLoading, isAdmin, navigate]);

  if (isLoading || !isAdmin) return null;

  return <UserManagement />;
}

function UserManagement() {
  const qc = useQueryClient();
  const listUsersFn = useServerFn(listUsers);
  const createUserFn = useServerFn(createUserAccount);
  const updateFieldsFn = useServerFn(updateUserFields);
  const deleteUserFn = useServerFn(deleteUserAccount);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userName, setUserName] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<string>(NO_ROLE);
  const [isApprover, setIsApprover] = useState(false);

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => listUsersFn() as Promise<UserRow[]>,
  });

  function resetForm() {
    setEmail("");
    setPassword("");
    setUserName("");
    setIsAdmin(false);
    setRole(NO_ROLE);
    setIsApprover(false);
  }

  const create = useMutation({
    mutationFn: () =>
      createUserFn({
        data: {
          email,
          password,
          userName,
          isAdmin,
          role: role === NO_ROLE ? null : (role as StaffRole),
          isTestCaseApprover: isApprover,
        },
      }),
    onSuccess: () => {
      toast.success(`Account created for ${email}`);
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const update = useMutation({
    mutationFn: (v: {
      id: string;
      isAdmin: boolean;
      role: StaffRole | null;
      isTestCaseApprover: boolean;
      isActive: boolean;
    }) => updateFieldsFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteUserFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Account deleted");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  function patch(
    u: UserRow,
    changes: Partial<Pick<UserRow, "is_admin" | "role" | "is_test_case_approver" | "is_active">>,
  ) {
    update.mutate({
      id: u.id,
      isAdmin: changes.is_admin ?? u.is_admin,
      role: "role" in changes ? (changes.role ?? null) : u.role,
      isTestCaseApprover: changes.is_test_case_approver ?? u.is_test_case_approver,
      isActive: changes.is_active ?? u.is_active,
    });
  }

  return (
    <AppShell>
      <PageHeader
        title="User & Role Management"
        description="Create accounts and set each person's admin access, job role, and test-case approver flag."
        actions={
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus /> New User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New User</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label>Display Name</Label>
                  <Input
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Must exactly match their name on CRs (BA / ITPM columns)"
                  />
                </div>
                <div>
                  <Label>Temporary Password</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Job Role</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ROLE}>None</SelectItem>
                      {JOB_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Admin</Label>
                  <Switch checked={isAdmin} onCheckedChange={setIsAdmin} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Test Case Approver</Label>
                  <Switch checked={isApprover} onCheckedChange={setIsApprover} />
                </div>
              </div>
              <DialogFooter>
                <Button
                  disabled={!email || !password || !userName || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "Creating…" : "Create Account"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <PageBody>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead className="w-24 text-center">Admin</TableHead>
                  <TableHead className="w-36">Job Role</TableHead>
                  <TableHead className="w-32 text-center">Approver</TableHead>
                  <TableHead className="w-24 text-center">Active</TableHead>
                  <TableHead>Created On</TableHead>
                  <TableHead className="text-right w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users.data ?? []).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>{u.user_name}</TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={u.is_admin}
                        onCheckedChange={(v) => patch(u, { is_admin: v })}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.role ?? NO_ROLE}
                        onValueChange={(v) => patch(u, { role: v === NO_ROLE ? null : (v as StaffRole) })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ROLE}>None</SelectItem>
                          {JOB_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={u.is_test_case_approver}
                        onCheckedChange={(v) => patch(u, { is_test_case_approver: v })}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={u.is_active}
                        onCheckedChange={(v) => patch(u, { is_active: v })}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Delete account ${u.email}?`)) del.mutate(u.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(users.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                      No users yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>
    </AppShell>
  );
}
── end disabled block ── */
