export type Store = {
  id: string;
  name: string;
  region: string;
  created_at: string;
}

export type Staff = {
  id: string;
  store_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  role: 'staff' | 'manager' | 'erp_admin' | 'training_admin' | 'super_admin';
  is_active: boolean;
  created_at: string;
  store?: Store;
}

export type Task = {
  id: string;
  store_id: string | null;
  customer_name: string;
  customer_phone: string;
  task_type: 'reorder' | 'winback' | 'pattern_break' | 'checkin' | 'upsell' | 'high_value' | 'cart_growth';
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'done' | 'skipped';
  notes: string | null;
  product_name: string | null;
  product_weight: string | null;
  product_sku: string | null;
  last_purchase_date: string | null;
  last_purchase_qty: number | null;
  replenishment_days: number | null;
  predicted_finish_date: string | null;
  followup_t_minus_4: string | null;
  followup_t_minus_2: string | null;
  due_date: string | null;
  followup_sequence: number;
  created_at: string;
  updated_at: string | null;
}

export type ReplenishmentRule = {
  id?: string;
  product_type: 'dry_food' | 'wet_food';
  brand: string | null;
  weight_min_kg: number;
  weight_max_kg: number;
  replenishment_days: number;
  is_global: boolean;
  store_id: string | null;
  updated_at?: string | null;
  created_by?: string | null;
}

export type Theme = {
  id: string;
  title: string;
  brief_text: string;
  is_active: boolean;
  created_at: string;
}

export type AiScoreBreakdown = {
  dimension: string;
  score: number;
  feedback: string;
}

export type AiScore = {
  overall: number;
  breakdown: AiScoreBreakdown[];
  summary: string;
}

export type RoleplaySubmission = {
  id: string;
  staff_id: string;
  store_id: string | null;
  theme_id: string;
  video_url: string;
  ai_score: AiScore | null;
  ai_reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  status: 'submitted' | 'ai_reviewed' | 'approved' | 'rejected';
  created_at: string;
  staff?: Staff;
  store?: Store;
  theme?: Theme;
}
