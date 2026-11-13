terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = "2.20.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "3.5.0"
    }
  }
}

provider "coder" {}
provider "kubernetes" {}

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

locals {
  paperclip_owned = data.coder_workspace_owner.me.id == "eefa942e-239a-4d30-802f-eb1b78dc671a"
  broker_enabled = contains(["c2033aa0-4b5a-4498-a69c-9c4728ca25a1", "eefa942e-239a-4d30-802f-eb1b78dc671a"], data.coder_workspace_owner.me.id)
}

data "coder_external_auth" "github" {
  optional = true
  id = "github"
}

resource "coder_agent" "main" {
  os                      = "linux"
  arch                    = "amd64"
  dir                     = "/home/coder/ari"
  startup_script          = templatefile("${path.module}/startup.sh", {
    cargo_cache_config = base64encode(file("${path.module}/cargo-cache.mjs"))
  })
  startup_script_behavior = "blocking"

  env = {
    GIT_CONFIG_SYSTEM = local.paperclip_owned ? "/usr/local/lib/foxberry-git/gitconfig" : "/etc/gitconfig"
    PATH                           = "/home/coder/.local/bin:/home/coder/.local/node/bin:/home/coder/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    NPM_CONFIG_REGISTRY             = "http://nexus-cache.nexus.svc.cluster.local:8080/repository/npm-proxy/"
    NPM_CONFIG_AUDIT                = "false"
    CARGO_REGISTRIES_FOXBERRY_INDEX = "sparse+http://nexus-cache.nexus.svc.cluster.local:8080/repository/cargo-proxy/"
    RUSTUP_DIST_SERVER             = "http://nexus-cache.nexus.svc.cluster.local:8080/repository/rust-dist-proxy"
    RUSTUP_UPDATE_ROOT             = "http://nexus-cache.nexus.svc.cluster.local:8080/repository/rust-dist-proxy/rustup"
    PLAYWRIGHT_DOWNLOAD_HOST       = "http://nexus-cache.nexus.svc.cluster.local:8080/repository/playwright-proxy"
  }

  display_apps {
    vscode          = false
    vscode_insiders = false
    web_terminal    = true
  }

  metadata {
    key          = "cpu"
    display_name = "CPU"
    script       = "/proc/1/exe stat cpu"
    interval     = 10
  }
  metadata {
    key          = "memory"
    display_name = "Memory"
    script       = "/proc/1/exe stat mem"
    interval     = 10
  }
  metadata {
    key          = "disk"
    display_name = "Home disk"
    script       = "/proc/1/exe stat disk --path /home/coder"
    interval     = 60
  }
}

resource "coder_app" "terminal_tools" {
  for_each = {
    opencode = { name = "OpenCode", icon = "/icon/opencode.svg", command = "opencode --standalone", order = 1 }
    lazygit  = { name = "LazyGit", icon = "/icon/git.svg", command = "lazygit", order = 2 }
    lazyvim  = { name = "LazyVim", icon = "https://cdn.simpleicons.org/vim", command = "nvim", order = 3 }
  }

  agent_id     = coder_agent.main.id
  slug         = each.key
  display_name = each.value.name
  icon         = each.value.icon
  command      = "cd /home/coder/ari && exec ${each.value.command}"
  order        = each.value.order
  share        = "owner"
  open_in      = "tab"
}

resource "kubernetes_persistent_volume_claim_v1" "home" {
  wait_until_bound = false

  metadata {
    name      = "ari-${data.coder_workspace.me.id}"
    namespace = "coder-workspaces"
    labels = {
      "foxberry.dev/project" = "ari"
    }
  }
  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "local-path"
    resources {
      requests = { storage = "20Gi" }
    }
  }
}

resource "kubernetes_pod_v1" "workspace" {
  count = data.coder_workspace.me.start_count
  metadata {
    name      = "ari-${data.coder_workspace.me.id}"
    namespace = "coder-workspaces"
    labels = {
      "foxberry.dev/project" = "ari"
      "coder.workspace_name" = data.coder_workspace.me.name
      "coder.owner"          = data.coder_workspace_owner.me.name
      "foxberry.dev/owner-id" = data.coder_workspace_owner.me.id
    }
  }
  spec {
    automount_service_account_token = false
    service_account_name = local.broker_enabled ? "broker-client" : "default"
    security_context {
      run_as_non_root = true
      run_as_user     = 1000
      run_as_group    = 1000
      fs_group        = 1000
      seccomp_profile {
        type = "RuntimeDefault"
      }
    }
    container {
      name    = "dev"
      image   = "codercom/enterprise-base:ubuntu@sha256:a1f98bc989522582a4f031a4b58d6d232a439227d22a67dc2fba43ebf2062d50"
      command = ["sh", "-c", coder_agent.main.init_script]
      env {
        name  = "CODER_AGENT_TOKEN"
        value = coder_agent.main.token
      }
      env {
        name  = "HOME"
        value = "/home/coder"
      }
      security_context {
        run_as_non_root            = true
        allow_privilege_escalation = false
        capabilities {
          drop = ["ALL"]
        }
      }
      readiness_probe {
        exec {
          command = ["test", "-f", "/tmp/ari-coder-ready"]
        }
        initial_delay_seconds = 180
        period_seconds        = 10
      }
      volume_mount {
        name       = "home"
        mount_path = "/home/coder"
      }
      dynamic "volume_mount" {
        for_each = local.paperclip_owned ? [1] : []
        content {
          name       = "git"
          mount_path = "/usr/local/lib/foxberry-git"
          read_only  = true
        }
      }
      dynamic "volume_mount" {
        for_each = local.broker_enabled ? { broker = "/opt/foxberry-broker", identity = "/var/run/foxberry-broker" } : {}
        content {
          name       = volume_mount.key
          mount_path = volume_mount.value
          read_only  = true
        }
      }
    }
    volume {
      name = "home"
      persistent_volume_claim {
        claim_name = kubernetes_persistent_volume_claim_v1.home.metadata[0].name
      }
    }
    dynamic "volume" {
      for_each = local.paperclip_owned ? [1] : []
      content {
        name = "git"
        secret {
          secret_name  = "paperclip-git-ari"
          default_mode = "0440"
        }
      }
    }
    dynamic "volume" {
      for_each = local.broker_enabled ? [1] : []
      content {
        name = "broker"
        config_map {
          name         = "subscription-broker-client"
          default_mode = "0555"
        }
      }
    }
    dynamic "volume" {
      for_each = local.broker_enabled ? [1] : []
      content {
        name = "identity"
        projected {
          default_mode = "0440"
          sources {
            service_account_token {
              audience           = "foxberry-broker"
              expiration_seconds = 600
              path               = "token"
            }
          }
        }
      }
    }
  }
}
