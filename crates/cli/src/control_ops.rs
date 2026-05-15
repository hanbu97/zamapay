use anyhow::{Context, Result, bail};
use shared::{CreatePaymentProjectRequest, CreateProjectApiKeyRequest};

use crate::client::ApiClient;
use crate::common::{
    control_context, init_env_bundle, output, present, print_json, print_project_overview,
    read_private_key, scoped_context, session_from_args, write_env_file,
};
use crate::config::{CliConfig, config_path, current_dir, effective_api_url, require};
use crate::{
    BillingPlanArg, ControlArgs, DoctorArgs, InitArgs, LoginArgs, ProjectArgs, ProjectCommand,
    ProjectCreateArgs, RailArgs, RailCommand, RailSetArgs, SecretArgs, SecretCommand, StatusArgs,
};

pub async fn login(args: LoginArgs) -> Result<()> {
    let mut config = CliConfig::load()?;
    let api_url = effective_api_url(args.api_url.as_deref(), &config);
    let private_key = read_private_key(args.private_key, args.private_key_stdin)?;
    let client = ApiClient::new(&api_url)?;
    let session = crate::auth::login_with_private_key(&client, &private_key).await?;
    let user = session.user.context("missing authenticated user")?;
    config.set_login(&api_url, &user.address, &user.session_id.to_string());
    config.save()?;
    if args.json {
        print_json(&serde_json::json!({
            "apiUrl": api_url,
            "ownerAddress": user.address,
            "sessionId": user.session_id,
            "configPath": config_path()?,
        }))?;
    } else {
        println!("signed in: {}", user.address);
        println!("api_url: {api_url}");
        println!("config: {}", config_path()?.display());
    }
    Ok(())
}

pub async fn logout(args: ControlArgs) -> Result<()> {
    let mut config = CliConfig::load()?;
    let api_url = effective_api_url(args.api_url.as_deref(), &config);
    let session_id = session_from_args(args.session_id.as_deref(), &config)?;
    let client = ApiClient::new(&api_url)?;
    let _ = client.logout(&session_id).await;
    config.clear_login();
    config.save()?;
    output(
        args.json,
        &serde_json::json!({ "loggedOut": true, "apiUrl": api_url }),
        || {
            println!("logged out");
            Ok(())
        },
    )
}

pub async fn whoami(args: ControlArgs) -> Result<()> {
    let (config, client, session_id) = control_context(&args)?;
    let session = client.session(&session_id).await?;
    if args.json {
        print_json(&session)?;
    } else if let Some(user) = session.user {
        println!("address: {}", user.address);
        println!("api_url: {}", client.api_url());
        if let Some(link) = config.linked_project_for_cwd(&current_dir()?) {
            println!("linked_project: {}", link.project_id);
        }
    } else {
        bail!("session is not authenticated");
    }
    Ok(())
}

pub async fn status(args: StatusArgs) -> Result<()> {
    let config = CliConfig::load()?;
    let api_url = effective_api_url(args.api_url.as_deref(), &config);
    let health = ApiClient::new(&api_url)?
        .health()
        .await
        .unwrap_or_else(|error| format!("error: {error}"));
    let link = config.linked_project_for_cwd(&current_dir()?);
    if args.json {
        print_json(&serde_json::json!({
            "apiUrl": api_url,
            "health": health,
            "configPath": config_path()?,
            "loggedIn": config.session_id.is_some(),
            "ownerAddress": config.owner_address,
            "linkedProject": link,
        }))?;
    } else {
        println!("api_url: {api_url}");
        println!("health: {health}");
        println!("config: {}", config_path()?.display());
        println!("logged_in: {}", config.session_id.is_some());
        if let Some(address) = config.owner_address {
            println!("owner_address: {address}");
        }
        if let Some(link) = link {
            println!("linked_project: {}", link.project_id);
        }
    }
    Ok(())
}

pub async fn init(args: InitArgs) -> Result<()> {
    let config = CliConfig::load()?;
    let api_url = effective_api_url(args.api_url.as_deref(), &config);
    let bundle = init_env_bundle(&api_url, args.secret_key.as_deref());
    if let Some(path) = args.write_env {
        write_env_file(&path, &bundle, args.force)?;
        println!("wrote {}", path.display());
    } else if args.json {
        print_json(&serde_json::json!({
            "apiUrl": api_url,
            "hasSecretKey": args.secret_key.is_some(),
            "env": bundle,
        }))?;
    } else {
        print!("{bundle}");
    }
    Ok(())
}

pub async fn doctor(args: DoctorArgs) -> Result<()> {
    let config = CliConfig::load()?;
    let api_url = effective_api_url(args.api_url.as_deref(), &config);
    let client = ApiClient::new(&api_url)?;
    let health = client
        .health()
        .await
        .unwrap_or_else(|error| format!("error: {error}"));
    let bootstrap = match args.secret_key.as_deref() {
        Some(secret_key) => match client.bootstrap(secret_key).await {
            Ok(value) => serde_json::json!({
                "ok": true,
                "projectId": value.project_id,
                "environment": value.environment,
                "hasWebhookSecret": value.webhook_secret.is_some(),
            }),
            Err(error) => serde_json::json!({ "ok": false, "error": error.to_string() }),
        },
        None => serde_json::json!({ "ok": false, "error": "ZAMAPAY_SECRET_KEY is not set" }),
    };
    if args.json {
        print_json(&serde_json::json!({
            "apiUrl": api_url,
            "health": health,
            "hasSecretKey": args.secret_key.is_some(),
            "bootstrap": bootstrap,
            "controlLoggedIn": config.session_id.is_some(),
        }))?;
    } else {
        println!("api_url: {api_url}");
        println!("health: {health}");
        println!("project_secret: {}", present(args.secret_key.is_some()));
        println!("control_login: {}", present(config.session_id.is_some()));
        println!("bootstrap: {bootstrap}");
    }
    Ok(())
}

pub async fn project(args: ProjectArgs) -> Result<()> {
    match args.command {
        ProjectCommand::List(control) => {
            let (_, client, session) = control_context(&control)?;
            let projects = client.list_projects(&session).await?;
            output(control.json, &projects, || {
                for project in &projects {
                    println!(
                        "{}  {}  {:?}",
                        project.project_id, project.name, project.status
                    );
                }
                Ok(())
            })
        }
        ProjectCommand::Create(args) => create_project(args).await,
        ProjectCommand::Show(scope) => {
            let (_, client, session, project_id) = scoped_context(&scope)?;
            let overview = client.project_overview(&session, &project_id).await?;
            output(scope.control.json, &overview, || {
                print_project_overview(&overview)
            })
        }
        ProjectCommand::Link(args) => {
            let (mut config, client, session) = control_context(&args.control)?;
            let overview = client.project_overview(&session, &args.project_id).await?;
            config.link_project(
                &current_dir()?,
                &overview.project.project_id,
                Some(&overview.project.name),
            );
            config.save()?;
            output(args.control.json, &overview.project, || {
                println!(
                    "linked {} to {}",
                    current_dir()?.display(),
                    overview.project.project_id
                );
                Ok(())
            })
        }
        ProjectCommand::Unlink(control) => {
            let mut config = CliConfig::load()?;
            let removed = config.unlink_project(&current_dir()?);
            config.save()?;
            output(control.json, &removed, || {
                println!("unlinked: {}", removed.is_some());
                Ok(())
            })
        }
    }
}

async fn create_project(args: ProjectCreateArgs) -> Result<()> {
    let (mut config, client, session) = control_context(&args.control)?;
    let response = client
        .create_project(
            &session,
            &CreatePaymentProjectRequest {
                name: args.name,
                environment: Some(args.environment.kind()),
                billing_plan: args.billing_plan.map(BillingPlanArg::plan),
                webhook_url: args.webhook_url,
            },
        )
        .await?;
    if args.link {
        config.link_project(
            &current_dir()?,
            &response.project.project_id,
            Some(&response.project.name),
        );
        config.save()?;
    }
    let secret = if args.create_secret {
        Some(
            client
                .create_project_secret(
                    &session,
                    &response.project.project_id,
                    &CreateProjectApiKeyRequest {
                        label: args.secret_label,
                        environment: Some(response.project.default_environment),
                    },
                )
                .await?,
        )
    } else {
        None
    };
    if args.control.json {
        print_json(&serde_json::json!({ "project": response, "projectSecret": secret }))?;
    } else {
        println!("project_id: {}", response.project.project_id);
        if let Some(secret) = secret {
            println!("ZAMAPAY_SECRET_KEY={}", secret.api_key);
        }
    }
    Ok(())
}

pub async fn rail(args: RailArgs) -> Result<()> {
    match args.command {
        RailCommand::List(scope) => {
            let (_, client, session, project_id) = scoped_context(&scope)?;
            let overview = client.project_overview(&session, &project_id).await?;
            output(scope.control.json, &overview.payment_rails, || {
                for rail in &overview.payment_rails {
                    println!("{}  enabled={}", rail.payment_rail.as_str(), rail.enabled);
                }
                Ok(())
            })
        }
        RailCommand::Enable(args) => set_rail(args, true).await,
        RailCommand::Disable(args) => set_rail(args, false).await,
    }
}

async fn set_rail(args: RailSetArgs, enabled: bool) -> Result<()> {
    let (_, client, session, project_id) = scoped_context(&args.scope)?;
    let overview = client
        .update_rail(&session, &project_id, args.payment_rail.as_str(), enabled)
        .await?;
    output(args.scope.control.json, &overview.payment_rails, || {
        println!("{} enabled={enabled}", args.payment_rail.as_str());
        Ok(())
    })
}

pub async fn secret(args: SecretArgs) -> Result<()> {
    match args.command {
        SecretCommand::List(scope) => {
            let (_, client, session, project_id) = scoped_context(&scope)?;
            let overview = client.project_overview(&session, &project_id).await?;
            output(scope.control.json, &overview.api_keys, || {
                for key in &overview.api_keys {
                    println!(
                        "{}  {}  prefix={}  revoked={}",
                        key.key_id,
                        key.label,
                        key.prefix,
                        key.revoked_at.is_some()
                    );
                }
                Ok(())
            })
        }
        SecretCommand::Create(args) => {
            let (_, client, session, project_id) = scoped_context(&args.scope)?;
            let secret = client
                .create_project_secret(
                    &session,
                    &project_id,
                    &CreateProjectApiKeyRequest {
                        label: args.label,
                        environment: args.environment.map(crate::EnvArg::kind),
                    },
                )
                .await?;
            if args.scope.control.json {
                print_json(&secret)?;
            } else if args.export_env {
                print!(
                    "{}",
                    init_env_bundle(client.api_url(), Some(&secret.api_key))
                );
            } else {
                println!("key_id: {}", secret.key_record.key_id);
                println!("secret_key: {}", secret.api_key);
            }
            Ok(())
        }
        SecretCommand::Revoke(args) => {
            require(args.yes, "secret revoke requires --yes")?;
            let (_, client, session, project_id) = scoped_context(&args.scope)?;
            let key = client
                .revoke_project_secret(&session, &project_id, &args.key_id)
                .await?;
            output(args.scope.control.json, &key, || {
                println!("revoked: {}", key.key_id);
                Ok(())
            })
        }
    }
}
