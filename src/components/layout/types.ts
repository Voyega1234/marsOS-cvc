export interface NavMainItem {
  id: string;
  title: string;
  url: string;
  icon: React.ElementType;
  isActive?: boolean;
}

export interface FavoriteItem {
  id: string;
  title: string;
  href: string;
  color: string; // tailwind bg class
}

export interface CollapsibleItem {
  id: string;
  title: string;
  icon: React.ElementType;
  href?: string;
}

export interface SidebarData {
  user: {
    name: string;
    email: string;
    avatar?: string;
  };
  navMain: NavMainItem[];
  navCollapsible: {
    favorites: FavoriteItem[];
    teams: CollapsibleItem[];
    topics: CollapsibleItem[];
  };
}
