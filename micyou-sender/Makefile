#
# MicYou wireless microphone sender (E5 -> PC MicYou server)
#
# Packages: the sender itself, the micyou-ctl helper, the shared UCI config,
# the canonical key table (usr/share/micyou/keys.uc) and the rpcd backend
# used by luci-app-micyou.
#
include $(TOPDIR)/rules.mk

PKG_NAME:=micyou-sender
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/micyou-sender
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=MicYou
  TITLE:=MicYou wireless microphone sender (E5 -> PC)
  DEPENDS:=+python3-light +python3-logging
endef

define Package/micyou-sender/description
  Streams the E5 microphone to a PC running the MicYou server, over the LAN.
  Managed by procd; connect/disconnect via micyou-ctl (also used by the info
  screen and by luci-app-micyou).
endef

define Build/Compile
endef

define Package/micyou-sender/install
	$(INSTALL_DIR) $(1)/usr/bin $(1)/usr/share/micyou $(1)/usr/share/rpcd/ucode
	$(INSTALL_DIR) $(1)/etc/init.d $(1)/etc/config
	$(INSTALL_BIN) ./root/usr/bin/micyou-ctl $(1)/usr/bin/micyou-ctl
	$(INSTALL_BIN) ./root/usr/bin/micyou_sender.py $(1)/usr/bin/micyou_sender.py
	$(INSTALL_DATA) ./root/usr/share/micyou/keys.uc $(1)/usr/share/micyou/keys.uc
	$(INSTALL_DATA) ./root/usr/share/rpcd/ucode/micyou.uc $(1)/usr/share/rpcd/ucode/micyou.uc
	$(INSTALL_BIN) ./root/etc/init.d/micyou-sender $(1)/etc/init.d/micyou-sender
	$(INSTALL_CONF) ./root/etc/config/micyou $(1)/etc/config/micyou
endef

$(eval $(call BuildPackage,micyou-sender))