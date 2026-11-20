export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      app_versions: {
        Row: {
          apk_url: string | null;
          created_at: string;
          file_name: string | null;
          forced: boolean;
          is_latest: boolean;
          public_url: string | null;
          release_notes: string;
          version: string;
        };
        Insert: {
          apk_url?: string | null;
          created_at?: string;
          file_name?: string | null;
          forced?: boolean;
          is_latest?: boolean;
          public_url?: string | null;
          release_notes?: string;
          version: string;
        };
        Update: {
          apk_url?: string | null;
          created_at?: string;
          file_name?: string | null;
          forced?: boolean;
          is_latest?: boolean;
          public_url?: string | null;
          release_notes?: string;
          version?: string;
        };
        Relationships: [];
      };
      operation_rows: {
        Row: {
          deleted: boolean;
          id: string;
          kind: string;
          payload: Json;
          property_code: string;
          receiver_staff_id: string | null;
          receiver_type: string;
          revision: number;
          is_private: boolean;
        };
        Insert: {
          deleted?: boolean;
          id: string;
          kind: string;
          payload: Json;
          property_code: string;
          receiver_staff_id?: string | null;
          receiver_type?: string;
          revision?: number;
          is_private?: boolean;
        };
        Update: {
          deleted?: boolean;
          id?: string;
          kind?: string;
          payload?: Json;
          property_code?: string;
          receiver_staff_id?: string | null;
          receiver_type?: string;
          revision?: number;
          is_private?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "operation_rows_property_code_fkey";
            columns: ["property_code"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["code"];
          },
        ];
      };
      property_backup_settings: {
        Row: {
          last_error: string | null;
          last_failure_at: string | null;
          last_success_at: string | null;
          lease_token: string | null;
          lease_until: string | null;
          next_run_at: string | null;
          property_code: string;
          schedule: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          last_error?: string | null;
          last_failure_at?: string | null;
          last_success_at?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          next_run_at?: string | null;
          property_code: string;
          schedule: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          last_error?: string | null;
          last_failure_at?: string | null;
          last_success_at?: string | null;
          lease_token?: string | null;
          lease_until?: string | null;
          next_run_at?: string | null;
          property_code?: string;
          schedule?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "property_backup_settings_property_code_fkey";
            columns: ["property_code"];
            isOneToOne: true;
            referencedRelation: "properties";
            referencedColumns: ["code"];
          },
        ];
      };
      property_backup_jobs: {
        Row: {
          attempt_count: number;
          available_at: string;
          property_code: string;
          queued_at: string;
        };
        Insert: {
          attempt_count?: number;
          available_at?: string;
          property_code: string;
          queued_at?: string;
        };
        Update: {
          attempt_count?: number;
          available_at?: string;
          property_code?: string;
          queued_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_backup_jobs_property_code_fkey";
            columns: ["property_code"];
            isOneToOne: true;
            referencedRelation: "properties";
            referencedColumns: ["code"];
          },
        ];
      };
      property_backup_runs: {
        Row: {
          backup_path: string | null;
          created_at: string;
          error_message: string | null;
          id: string;
          property_code: string;
          record_count: number | null;
          schedule: string;
          status: string;
          trigger_type: string;
        };
        Insert: {
          backup_path?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          property_code: string;
          record_count?: number | null;
          schedule: string;
          status: string;
          trigger_type: string;
        };
        Update: {
          backup_path?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          property_code?: string;
          record_count?: number | null;
          schedule?: string;
          status?: string;
          trigger_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "property_backup_runs_property_code_fkey";
            columns: ["property_code"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["code"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          property_code: string | null;
          username: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          name?: string;
          property_code?: string | null;
          username?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          property_code?: string | null;
          username?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_property_code_fkey";
            columns: ["property_code"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["code"];
          },
        ];
      };
      staff_attendance: {
        Row: {
          check_in: string;
          check_out: string | null;
          created_at: string;
          department: string;
          grace_minutes: number;
          id: string;
          is_late: boolean;
          late_minutes: number;
          property_code: string;
          reporting_time: string;
          shift_date: string;
          staff_name: string;
          user_id: string;
        };
        Insert: {
          check_in?: string;
          check_out?: string | null;
          created_at?: string;
          department: string;
          grace_minutes?: number;
          id?: string;
          is_late?: boolean;
          late_minutes?: number;
          property_code: string;
          reporting_time?: string;
          shift_date: string;
          staff_name: string;
          user_id: string;
        };
        Update: {
          check_in?: string;
          check_out?: string | null;
          created_at?: string;
          department?: string;
          grace_minutes?: number;
          id?: string;
          is_late?: boolean;
          late_minutes?: number;
          property_code?: string;
          reporting_time?: string;
          shift_date?: string;
          staff_name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      allowed_networks: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          ip_address: string;
          label: string;
          property_code: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          ip_address: string;
          label: string;
          property_code: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          ip_address?: string;
          label?: string;
          property_code?: string;
        };
        Relationships: [
          {
            foreignKeyName: "allowed_networks_property_code_fkey";
            columns: ["property_code"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["code"];
          },
        ];
      };
      properties: {
        Row: {
          address: string;
          billing_email: string | null;
          code: string;
          created_at: string;
          image_url: string | null;
          name: string;
          phone: string;
          property_type: string;
        };
        Insert: {
          address?: string;
          billing_email?: string | null;
          code: string;
          created_at?: string;
          image_url?: string | null;
          name: string;
          phone?: string;
          property_type?: string;
        };
        Update: {
          address?: string;
          billing_email?: string | null;
          code?: string;
          created_at?: string;
          image_url?: string | null;
          name?: string;
          phone?: string;
          property_type?: string;
        };
        Relationships: [];
      };
      staff_members: {
        Row: {
          active: boolean;
          auth_user_id: string;
          company_email: string;
          created_at: string;
          department: string;
          pin_hash: string;
          pin_setup_required: boolean;
          property_code: string;
          role: string;
          staff_name: string;
        };
        Insert: {
          active?: boolean;
          auth_user_id: string;
          company_email: string;
          created_at?: string;
          department: string;
          pin_hash: string;
          pin_setup_required?: boolean;
          property_code: string;
          role: string;
          staff_name: string;
        };
        Update: {
          active?: boolean;
          auth_user_id?: string;
          company_email?: string;
          created_at?: string;
          department?: string;
          pin_hash?: string;
          pin_setup_required?: boolean;
          property_code?: string;
          role?: string;
          staff_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_members_property_code_fkey";
            columns: ["property_code"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["code"];
          },
        ];
      };
      work_shifts: {
        Row: {
          created_at: string;
          created_by: string;
          department: string;
          grace_minutes: number;
          id: string;
          property_code: string;
          reporting_time: string;
          shift_date: string;
          shift_pattern: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          department: string;
          grace_minutes?: number;
          id?: string;
          property_code: string;
          reporting_time?: string;
          shift_date: string;
          shift_pattern?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          department?: string;
          grace_minutes?: number;
          id?: string;
          property_code?: string;
          reporting_time?: string;
          shift_date?: string;
          shift_pattern?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          property_code: string;
          role: string;
          user_id: string;
        };
        Insert: {
          property_code: string;
          role: string;
          user_id: string;
        };
        Update: {
          property_code?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_property_code_fkey";
            columns: ["property_code"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["code"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      gpm_mutate: {
        Args: {
          p_deleted?: boolean;
          p_id: string;
          p_kind: string;
          p_payload: Json;
          p_revision: number;
        };
        Returns: number;
      };
      gpm_hash_staff_pin: {
        Args: { p_pin: string };
        Returns: string;
      };
      gpm_verify_staff_pin: {
        Args: { p_pin: string; p_user_id: string };
        Returns: boolean;
      };
      gpm_authenticate_staff: {
        Args: {
          p_code: string;
          p_department: string;
          p_email: string;
          p_pin: string;
          p_staff_name: string;
        };
        Returns: string;
      };
      gpm_check_in: {
        Args: { p_client_ip: string; p_user_id: string };
        Returns: Database["public"]["Tables"]["staff_attendance"]["Row"];
      };
      gpm_check_out: {
        Args: { p_client_ip: string; p_user_id: string };
        Returns: Database["public"]["Tables"]["staff_attendance"]["Row"];
      };
      gpm_is_attendance_network_allowed: {
        Args: { p_client_ip: string; p_property_code: string };
        Returns: boolean;
      };
      gpm_property: { Args: never; Returns: string };
      gpm_role: { Args: never; Returns: string };
      gpm_set_property_backup_schedule: {
        Args: { p_schedule: string };
        Returns: Database["public"]["Tables"]["property_backup_settings"]["Row"];
      };
      gpm_record_property_backup_run: {
        Args: {
          p_backup_path?: string | null;
          p_error_message?: string | null;
          p_record_count?: number | null;
          p_status: string;
        };
        Returns: string;
      };
      gpm_setup: {
        Args: {
          p_address: string;
          p_code: string;
          p_name: string;
          p_phone: string;
        };
        Returns: undefined;
      };
      gpm_setup_with_billing: {
        Args: {
          p_address: string;
          p_billing_email: string;
          p_code: string;
          p_name: string;
          p_phone: string;
          p_property_type: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
