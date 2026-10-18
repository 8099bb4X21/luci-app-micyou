#
# MicYou wireless microphone - LuCI interface
#
# Server address, the connect/disconnect physical keys, and immediate
# connect/disconnect.  Backed by the micyou-sender package (rpcd object
# "micyou", /etc/config/micyou and the canonical key table).
#
include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI app for MicYou wireless microphone
LUCI_DEPENDS:=+micyou-sender
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-micyou
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

include $(INCLUDE_DIR)/package.mk
include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature