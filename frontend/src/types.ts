export type OrderCategory = "loading" | "unloading" | "installation";

export const CATEGORY_LABELS: Record<OrderCategory, string> = {
  loading: "Погрузка",
  unloading: "Разгрузка",
  installation: "Монтаж",
};

export interface Me {
  id: string;
  telegramId: number;
  role: "employer" | "worker" | "admin";
  name: string | null;
  phone: string | null;
  rating: string;
  ratingCount: number;
  noShowCount: number;
  notifyEnabled: boolean;
  notifyCategories: OrderCategory[] | null;
  banned?: boolean;
}

export interface MyResponse {
  id: string;
  status: "pending" | "accepted" | "rejected";
  confirmedAt: string | null;
}

export interface Order {
  id: string;
  category: OrderCategory;
  basePay: number;
  overtimeRate: number;
  minHours: number;
  workersNeeded: number;
  date: string;
  startTime: string;
  address: string | null;
  description: string | null;
  status: "open" | "in_progress" | "completed" | "cancelled";
  latitude: number | null;
  longitude: number | null;
  employerId?: string;
  employerName?: string | null;
  employerRating?: string;
  employerUsername?: string | null;
  acceptedCount?: number;
  myResponse?: MyResponse | null;
}

export interface OrdersPage<T = Order> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ReviewValues {
  punctuality: number;
  quality: number;
  adequacy: number;
  comment: string;
}

export interface UserReview {
  id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  adequacy: number | null;
  comment: string | null;
  createdAt: string;
  reviewerId: string;
  reviewerName: string | null;
}

export interface PublicProfile {
  id: string;
  name: string | null;
  role: string;
  rating: string;
  ratingCount: number;
  noShowCount: number;
  createdAt: string;
}
