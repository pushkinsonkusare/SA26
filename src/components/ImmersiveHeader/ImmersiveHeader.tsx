import { useState } from "react";
import {
  MenuIcon,
  SearchIcon,
  ShoppingCartIcon,
  SparkleIcon,
  StoreIcon,
  UserIcon,
} from "../icons/StorefrontIcons";
import PrototypeBrandLink from "../PrototypeBrandLink";
import { useSearchOverlay } from "../SearchOverlay/SearchOverlayContext";
import { ROUTES, usePrototypeNavigation } from "../../prototypeRoutes";
import { PRIMARY_NAV_ITEMS, SITE_BRAND } from "../../siteContent";
import djiLogo from "../../assets/dji-logo.png";
import { ImmersiveHeaderMobileSheet } from "./ImmersiveHeaderMobileSheet";
import "./ImmersiveHeader.css";

/**
 * Immersive-mode storefront header. Mirrors Figma node 58:30763 ("NBA-brainstorm"
 * file) — a light, full-width row with the brand, primary nav, a black "Wingman"
 * pill, and a 5-icon action group on the right.
 *
 * Scope: only mounted by callers that have already gated on
 * `useAgentMode().mode === "immersive"`. Every selector below is namespaced
 * `.immersive-header*` so it cannot bleed into the other three modes.
 */
export function ImmersiveHeader() {
  const { navigate } = usePrototypeNavigation();
  const { openSearchOverlay } = useSearchOverlay();
  /* Drives the mobile drawer (`<ImmersiveHeaderMobileSheet/>`). The
   * hamburger toggle that flips this is itself only visible under the
   * 768px breakpoint — desktop never sees the menu state. */
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleWingman = () => {
    navigate(ROUTES.wingman);
  };

  const handleNav = (category: string | null) => {
    navigate(ROUTES.productListing, { category });
  };

  return (
    <header className="immersive-header" role="banner">
      <PrototypeBrandLink className="immersive-header__brand">
        <img
          className="immersive-header__brand-logo"
          src={djiLogo}
          alt={SITE_BRAND}
        />
      </PrototypeBrandLink>

      <nav className="immersive-header__nav" aria-label="Primary">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            className={
              "immersive-header__nav-link" +
              (item.emphasized ? " immersive-header__nav-link--emphasized" : "")
            }
            onClick={() => handleNav(item.category ?? null)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <button
        type="button"
        className="immersive-header__wingman"
        onClick={handleWingman}
        aria-label="Open Wingman assistant"
      >
        <span className="immersive-header__wingman-label">Wingman</span>
        <SparkleIcon
          className="immersive-header__wingman-icon"
          width={12}
          height={12}
        />
      </button>

      <div className="immersive-header__actions" aria-label="Account & cart">
        <button
          type="button"
          className="immersive-header__action"
          aria-label="Search"
          onClick={openSearchOverlay}
        >
          <SearchIcon width={16} height={16} />
        </button>
        <button
          type="button"
          className="immersive-header__action"
          aria-label="Wingman shortcut"
          onClick={handleWingman}
        >
          <SparkleIcon width={16} height={16} />
        </button>
        <button
          type="button"
          className="immersive-header__action"
          aria-label="About DJI"
          onClick={() => navigate(ROUTES.about)}
        >
          <StoreIcon width={16} height={16} />
        </button>
        <button
          type="button"
          className="immersive-header__action"
          aria-label="Account"
          onClick={() => navigate(ROUTES.login)}
        >
          <UserIcon width={16} height={16} />
        </button>
        <button
          type="button"
          className="immersive-header__action immersive-header__action--cart"
          aria-label="Cart"
          onClick={() => navigate(ROUTES.cart)}
        >
          <ShoppingCartIcon width={16} height={16} />
        </button>
      </div>

      {/* Hamburger toggle: only visible below 768px (CSS gate). The
        * sheet itself is portal-rendered so it isn't trapped by the
        * sticky header's stacking context. */}
      <button
        type="button"
        className="immersive-header__menu-toggle"
        aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
        aria-expanded={mobileMenuOpen}
        onClick={() => setMobileMenuOpen(true)}
      >
        <MenuIcon width={20} height={20} />
      </button>
      <ImmersiveHeaderMobileSheet
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />
    </header>
  );
}

export default ImmersiveHeader;
