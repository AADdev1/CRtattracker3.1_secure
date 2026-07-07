export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      crs: {
        Row: {
          application: string | null
          assigned_team: string | null
          assigned_user: string | null
          ba: string | null
          brd_signoff_awaited_by_ba: string | null
          brd_signoff_date_by_ba: string | null
          brd_start_date: string | null
          cr_number: string
          cr_size: Database["public"]["Enums"]["cr_size"] | null
          created_at: string
          created_user: string | null
          date_created: string | null
          date_modified: string | null
          department: string | null
          expected_go_live_date: string | null
          hod: string | null
          is_dropped: boolean
          it_vertical_head: string | null
          itpm: string | null
          kom: string | null
          kom_department: string | null
          lob: string | null
          manual_notes: string | null
          module_name: string | null
          planned_development_date: string | null
          planned_production_date: string | null
          planned_uat_release_date: string | null
          product: string | null
          s01_concept_doc_generated: string | null
          s02_concept_doc_approved: string | null
          s03_concept_dropped: string | null
          s03c_priority_changed: string | null
          s03d_prioritize: string | null
          s04_requirement_discussed: string | null
          s05_requirement_dropped: string | null
          s06_requirement_approved: string | null
          s07_brd_not_started: string | null
          s08_brd_wip: string | null
          s09_brd_dropped: string | null
          s10_dependent_cr_raised: string | null
          s11_brd_signoff_awaited: string | null
          s12_brd_signed_off: string | null
          s13_pending_in_tech_pipeline: string | null
          s14_brd_tech_clarification: string | null
          s14a_cr_on_cr: string | null
          s14a_cr_on_cr_push_back: string | null
          s14b_approved_cr_on_cr: string | null
          s14c_not_a_cr_on_cr: string | null
          s14d_approach_note_shared: string | null
          s14e_tech_clarification_priority_changed: string | null
          s14f_approach_note_signed_off: string | null
          s14g_approach_note_sent_back_for_revision: string | null
          s15_brd_sent_back_for_revision: string | null
          s16_dev_approved_timelines_awaited: string | null
          s17_timelines_provided_dev_to_start: string | null
          s18_dev_wip: string | null
          s19_dev_on_hold_pending_with_partner: string | null
          s20_released_for_uat: string | null
          s21_uat_wip: string | null
          s21a_uat_on_hold_dependency: string | null
          s21b_uat_on_hold_priority_changed: string | null
          s21c_uat_demo_rejected: string | null
          s22_uat_bug_raised: string | null
          s23_uat_signoff_awaited: string | null
          s24_uat_signed_off: string | null
          s24a_technical_go_live: string | null
          s25_security_signed_off: string | null
          s25a_security_signed_off_on_tech_go: string | null
          s26_assign_to_release_team: string | null
          s26_tech_go_assign_to_release_team: string | null
          s27_release_package_rejected: string | null
          s27a_tech_go_release_package_rejected: string | null
          s28_deployed_in_production: string | null
          s28_tech_go_deployed_in_production: string | null
          s29_live_and_closed: string | null
          s30_issue_in_production: string | null
          severity: string | null
          testing_percentage: number | null
          title: string | null
          uat_signoff_awaited_by_ba: string | null
          uat_signoff_date_by_ba: string | null
          updated_at: string
          workflow_status: string | null
        }
        Insert: {
          application?: string | null
          assigned_team?: string | null
          assigned_user?: string | null
          ba?: string | null
          brd_signoff_awaited_by_ba?: string | null
          brd_signoff_date_by_ba?: string | null
          brd_start_date?: string | null
          cr_number: string
          cr_size?: Database["public"]["Enums"]["cr_size"] | null
          created_at?: string
          created_user?: string | null
          date_created?: string | null
          date_modified?: string | null
          department?: string | null
          expected_go_live_date?: string | null
          hod?: string | null
          is_dropped?: boolean
          it_vertical_head?: string | null
          itpm?: string | null
          kom?: string | null
          kom_department?: string | null
          lob?: string | null
          manual_notes?: string | null
          module_name?: string | null
          planned_development_date?: string | null
          planned_production_date?: string | null
          planned_uat_release_date?: string | null
          product?: string | null
          s01_concept_doc_generated?: string | null
          s02_concept_doc_approved?: string | null
          s03_concept_dropped?: string | null
          s03c_priority_changed?: string | null
          s03d_prioritize?: string | null
          s04_requirement_discussed?: string | null
          s05_requirement_dropped?: string | null
          s06_requirement_approved?: string | null
          s07_brd_not_started?: string | null
          s08_brd_wip?: string | null
          s09_brd_dropped?: string | null
          s10_dependent_cr_raised?: string | null
          s11_brd_signoff_awaited?: string | null
          s12_brd_signed_off?: string | null
          s13_pending_in_tech_pipeline?: string | null
          s14_brd_tech_clarification?: string | null
          s14a_cr_on_cr?: string | null
          s14a_cr_on_cr_push_back?: string | null
          s14b_approved_cr_on_cr?: string | null
          s14c_not_a_cr_on_cr?: string | null
          s14d_approach_note_shared?: string | null
          s14e_tech_clarification_priority_changed?: string | null
          s14f_approach_note_signed_off?: string | null
          s14g_approach_note_sent_back_for_revision?: string | null
          s15_brd_sent_back_for_revision?: string | null
          s16_dev_approved_timelines_awaited?: string | null
          s17_timelines_provided_dev_to_start?: string | null
          s18_dev_wip?: string | null
          s19_dev_on_hold_pending_with_partner?: string | null
          s20_released_for_uat?: string | null
          s21_uat_wip?: string | null
          s21a_uat_on_hold_dependency?: string | null
          s21b_uat_on_hold_priority_changed?: string | null
          s21c_uat_demo_rejected?: string | null
          s22_uat_bug_raised?: string | null
          s23_uat_signoff_awaited?: string | null
          s24_uat_signed_off?: string | null
          s24a_technical_go_live?: string | null
          s25_security_signed_off?: string | null
          s25a_security_signed_off_on_tech_go?: string | null
          s26_assign_to_release_team?: string | null
          s26_tech_go_assign_to_release_team?: string | null
          s27_release_package_rejected?: string | null
          s27a_tech_go_release_package_rejected?: string | null
          s28_deployed_in_production?: string | null
          s28_tech_go_deployed_in_production?: string | null
          s29_live_and_closed?: string | null
          s30_issue_in_production?: string | null
          severity?: string | null
          testing_percentage?: number | null
          title?: string | null
          uat_signoff_awaited_by_ba?: string | null
          uat_signoff_date_by_ba?: string | null
          updated_at?: string
          workflow_status?: string | null
        }
        Update: {
          application?: string | null
          assigned_team?: string | null
          assigned_user?: string | null
          ba?: string | null
          brd_signoff_awaited_by_ba?: string | null
          brd_signoff_date_by_ba?: string | null
          brd_start_date?: string | null
          cr_number?: string
          cr_size?: Database["public"]["Enums"]["cr_size"] | null
          created_at?: string
          created_user?: string | null
          date_created?: string | null
          date_modified?: string | null
          department?: string | null
          expected_go_live_date?: string | null
          hod?: string | null
          is_dropped?: boolean
          it_vertical_head?: string | null
          itpm?: string | null
          kom?: string | null
          kom_department?: string | null
          lob?: string | null
          manual_notes?: string | null
          module_name?: string | null
          planned_development_date?: string | null
          planned_production_date?: string | null
          planned_uat_release_date?: string | null
          product?: string | null
          s01_concept_doc_generated?: string | null
          s02_concept_doc_approved?: string | null
          s03_concept_dropped?: string | null
          s03c_priority_changed?: string | null
          s03d_prioritize?: string | null
          s04_requirement_discussed?: string | null
          s05_requirement_dropped?: string | null
          s06_requirement_approved?: string | null
          s07_brd_not_started?: string | null
          s08_brd_wip?: string | null
          s09_brd_dropped?: string | null
          s10_dependent_cr_raised?: string | null
          s11_brd_signoff_awaited?: string | null
          s12_brd_signed_off?: string | null
          s13_pending_in_tech_pipeline?: string | null
          s14_brd_tech_clarification?: string | null
          s14a_cr_on_cr?: string | null
          s14a_cr_on_cr_push_back?: string | null
          s14b_approved_cr_on_cr?: string | null
          s14c_not_a_cr_on_cr?: string | null
          s14d_approach_note_shared?: string | null
          s14e_tech_clarification_priority_changed?: string | null
          s14f_approach_note_signed_off?: string | null
          s14g_approach_note_sent_back_for_revision?: string | null
          s15_brd_sent_back_for_revision?: string | null
          s16_dev_approved_timelines_awaited?: string | null
          s17_timelines_provided_dev_to_start?: string | null
          s18_dev_wip?: string | null
          s19_dev_on_hold_pending_with_partner?: string | null
          s20_released_for_uat?: string | null
          s21_uat_wip?: string | null
          s21a_uat_on_hold_dependency?: string | null
          s21b_uat_on_hold_priority_changed?: string | null
          s21c_uat_demo_rejected?: string | null
          s22_uat_bug_raised?: string | null
          s23_uat_signoff_awaited?: string | null
          s24_uat_signed_off?: string | null
          s24a_technical_go_live?: string | null
          s25_security_signed_off?: string | null
          s25a_security_signed_off_on_tech_go?: string | null
          s26_assign_to_release_team?: string | null
          s26_tech_go_assign_to_release_team?: string | null
          s27_release_package_rejected?: string | null
          s27a_tech_go_release_package_rejected?: string | null
          s28_deployed_in_production?: string | null
          s28_tech_go_deployed_in_production?: string | null
          s29_live_and_closed?: string | null
          s30_issue_in_production?: string | null
          severity?: string | null
          testing_percentage?: number | null
          title?: string | null
          uat_signoff_awaited_by_ba?: string | null
          uat_signoff_date_by_ba?: string | null
          updated_at?: string
          workflow_status?: string | null
        }
        Relationships: []
      }
      defect_status_mapping: {
        Row: {
          created_at: string
          id: string
          is_open: boolean
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_open?: boolean
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_open?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      defects: {
        Row: {
          application: string | null
          cr_number: string
          created_at: string
          date_created: string | null
          date_modified: string | null
          defect_no: string
          defect_raised_by: string | null
          environment: string | null
          id: string
          last_modified_by: string | null
          module: string | null
          nature_of_defect: string | null
          new_status: string | null
          old_status: string | null
          priority: string | null
          product: string | null
          severity: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          application?: string | null
          cr_number: string
          created_at?: string
          date_created?: string | null
          date_modified?: string | null
          defect_no: string
          defect_raised_by?: string | null
          environment?: string | null
          id?: string
          last_modified_by?: string | null
          module?: string | null
          nature_of_defect?: string | null
          new_status?: string | null
          old_status?: string | null
          priority?: string | null
          product?: string | null
          severity?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          application?: string | null
          cr_number?: string
          created_at?: string
          date_created?: string | null
          date_modified?: string | null
          defect_no?: string
          defect_raised_by?: string | null
          environment?: string | null
          id?: string
          last_modified_by?: string | null
          module?: string | null
          nature_of_defect?: string | null
          new_status?: string | null
          old_status?: string | null
          priority?: string | null
          product?: string | null
          severity?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "defects_cr_number_fkey"
            columns: ["cr_number"]
            isOneToOne: false
            referencedRelation: "crs"
            referencedColumns: ["cr_number"]
          },
        ]
      }
      kpi_excluded_statuses: {
        Row: {
          created_at: string
          id: string
          kpi_id: string
          workflow_status_code: string
        }
        Insert: {
          created_at?: string
          id?: string
          kpi_id: string
          workflow_status_code: string
        }
        Update: {
          created_at?: string
          id?: string
          kpi_id?: string
          workflow_status_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_excluded_statuses_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpis"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_results: {
        Row: {
          computed_at: string
          cr_number: string
          effective_days: number | null
          end_date: string | null
          hold_days: number | null
          id: string
          kpi_id: string
          remaining_days: number | null
          start_date: string | null
          status: Database["public"]["Enums"]["kpi_status"]
          tat: number | null
          utilization_pct: number | null
          working_days: number | null
        }
        Insert: {
          computed_at?: string
          cr_number: string
          effective_days?: number | null
          end_date?: string | null
          hold_days?: number | null
          id?: string
          kpi_id: string
          remaining_days?: number | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["kpi_status"]
          tat?: number | null
          utilization_pct?: number | null
          working_days?: number | null
        }
        Update: {
          computed_at?: string
          cr_number?: string
          effective_days?: number | null
          end_date?: string | null
          hold_days?: number | null
          id?: string
          kpi_id?: string
          remaining_days?: number | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["kpi_status"]
          tat?: number | null
          utilization_pct?: number | null
          working_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_results_cr_number_fkey"
            columns: ["cr_number"]
            isOneToOne: false
            referencedRelation: "crs"
            referencedColumns: ["cr_number"]
          },
          {
            foreignKeyName: "kpi_results_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "kpis"
            referencedColumns: ["id"]
          },
        ]
      }
      kpis: {
        Row: {
          created_at: string
          end_status_code: string
          id: string
          is_active: boolean
          large_tat: number
          medium_tat: number
          name: string
          role: Database["public"]["Enums"]["kpi_role"]
          small_tat: number
          start_status_code: string
          updated_at: string
          warning_pct: number
        }
        Insert: {
          created_at?: string
          end_status_code: string
          id?: string
          is_active?: boolean
          large_tat: number
          medium_tat: number
          name: string
          role?: Database["public"]["Enums"]["kpi_role"]
          small_tat: number
          start_status_code: string
          updated_at?: string
          warning_pct?: number
        }
        Update: {
          created_at?: string
          end_status_code?: string
          id?: string
          is_active?: boolean
          large_tat?: number
          medium_tat?: number
          name?: string
          role?: Database["public"]["Enums"]["kpi_role"]
          small_tat?: number
          start_status_code?: string
          updated_at?: string
          warning_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "kpis_end_status_code_fkey"
            columns: ["end_status_code"]
            isOneToOne: false
            referencedRelation: "workflow_statuses"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "kpis_start_status_code_fkey"
            columns: ["start_status_code"]
            isOneToOne: false
            referencedRelation: "workflow_statuses"
            referencedColumns: ["code"]
          },
        ]
      }
      kpi_engine_lock: {
        Row: {
          id: string
          is_running: boolean
          started_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          is_running?: boolean
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          is_running?: boolean
          started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      test_cases: {
        Row: {
          approval_date: string | null
          approved_by: string | null
          approver_comments: string | null
          created_at: string
          cr_number: string
          defect_id: string | null
          execution_status: Database["public"]["Enums"]["test_case_execution_status"]
          expected_result: string
          id: string
          needs_retest: boolean
          status: Database["public"]["Enums"]["test_case_status"]
          test_case_name: string
          test_case_number: string
          test_condition: string
          test_priority: string | null
          tester_comments: string | null
          uploaded_by: string
          uploaded_date: string
          updated_at: string
        }
        Insert: {
          approval_date?: string | null
          approved_by?: string | null
          approver_comments?: string | null
          created_at?: string
          cr_number: string
          defect_id?: string | null
          execution_status?: Database["public"]["Enums"]["test_case_execution_status"]
          expected_result: string
          id?: string
          needs_retest?: boolean
          status?: Database["public"]["Enums"]["test_case_status"]
          test_case_name: string
          test_case_number: string
          test_condition: string
          test_priority?: string | null
          tester_comments?: string | null
          uploaded_by: string
          uploaded_date?: string
          updated_at?: string
        }
        Update: {
          approval_date?: string | null
          approved_by?: string | null
          approver_comments?: string | null
          created_at?: string
          cr_number?: string
          defect_id?: string | null
          execution_status?: Database["public"]["Enums"]["test_case_execution_status"]
          expected_result?: string
          id?: string
          needs_retest?: boolean
          status?: Database["public"]["Enums"]["test_case_status"]
          test_case_name?: string
          test_case_number?: string
          test_condition?: string
          test_priority?: string | null
          tester_comments?: string | null
          uploaded_by?: string
          uploaded_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_cases_cr_number_fkey"
            columns: ["cr_number"]
            isOneToOne: false
            referencedRelation: "crs"
            referencedColumns: ["cr_number"]
          },
        ]
      }
      user_management: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          is_admin: boolean
          is_test_case_approver: boolean
          password_hash: string | null
          role: Database["public"]["Enums"]["staff_role"] | null
          updated_at: string
          user_name: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          is_admin?: boolean
          is_test_case_approver?: boolean
          password_hash?: string | null
          role?: Database["public"]["Enums"]["staff_role"] | null
          updated_at?: string
          user_name: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          is_admin?: boolean
          is_test_case_approver?: boolean
          password_hash?: string | null
          role?: Database["public"]["Enums"]["staff_role"] | null
          updated_at?: string
          user_name?: string
        }
        Relationships: []
      }
      workflow_statuses: {
        Row: {
          code: string
          created_at: string
          db_column: string
          id: string
          label: string
          remarks: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          db_column: string
          id?: string
          label: string
          remarks?: string | null
          sort_order: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          db_column?: string
          id?: string
          label?: string
          remarks?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role: "ITPM" | "BA" | "Admin"
      cr_size: "Small" | "Medium" | "Large"
      kpi_role: "ITPM" | "BA"
      kpi_status: "pending" | "not_started" | "green" | "amber" | "red"
      staff_role: "BA" | "ITPM" | "PMO" | "Tester"
      test_case_status: "Pending" | "Submitted" | "Sent Back for Revision" | "Approved"
      test_case_execution_status: "Pending" | "Tested" | "Defect Raised"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["ITPM", "BA", "Admin"],
      cr_size: ["Small", "Medium", "Large"],
      kpi_role: ["ITPM", "BA"],
      kpi_status: ["pending", "not_started", "green", "amber", "red"],
      staff_role: ["BA", "ITPM", "PMO", "Tester"],
      test_case_status: ["Pending", "Submitted", "Sent Back for Revision", "Approved"],
      test_case_execution_status: ["Pending", "Tested", "Defect Raised"],
    },
  },
} as const
