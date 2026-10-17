// `tagdown`: the Tagdown vault from the command line, and its MCP server.

use std::{
    io::{self, IsTerminal, Read},
    path::PathBuf,
    process::ExitCode,
};

use tagdown_core::{
    library::{day_title, resolve_day, Library, TaskFilter, SYNTAX},
    mcp,
    vaults::VaultList,
};

const USAGE: &str = "\
tagdown — your Tagdown notes from the command line

Usage: tagdown [--vault PATH] <command> [arguments]

Commands:
  search <query>              Full-text search (tag:name, title:word, \"phrase\", -word)
  list [--folder NAME] [--tag TAG] [--limit N]
                              Notes, most recently edited first
  show <note>                 Print a note (by title or id)
  new <title> [text | -] [--type TYPE]
                              Create a note; `-` reads the body from stdin;
                              a type starts it from that type's template
  append <note> <text | ->    Add text to the end of a note
  journal [day] [text | -]    Print a day's journal page, or add text to it
                              (day: YYYY-MM-DD, today, yesterday, tomorrow)
  tasks [--done | --all] [--tag TAG]
                              Checklist items across notes (open ones by default)
  backlinks <note>            Notes that link to a note
  query <query>               What a <query /> block lists, e.g. tag:project show:tasks
  syntax                      The Tagdown syntax reference
  mcp                         Run the MCP server on stdin/stdout for AI assistants

The vault is the one the app has open (~/Documents/Tagdown at first) unless
--vault or TAGDOWN_VAULT says otherwise.
";

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("tagdown: {message}");
            ExitCode::FAILURE
        }
    }
}

/// Remove `--name VALUE` from `args`, returning VALUE.
fn take_option(args: &mut Vec<String>, name: &str) -> Result<Option<String>, String> {
    let Some(at) = args.iter().position(|a| a == name) else { return Ok(None) };
    if at + 1 >= args.len() {
        return Err(format!("{name} needs a value"));
    }
    let value = args.remove(at + 1);
    args.remove(at);
    Ok(Some(value))
}

fn take_flag(args: &mut Vec<String>, name: &str) -> bool {
    let found = args.iter().position(|a| a == name);
    if let Some(at) = found {
        args.remove(at);
    }
    found.is_some()
}

/// The text argument, or stdin when it is `-`.
fn text_arg(parts: &[String]) -> Result<String, String> {
    if parts.len() == 1 && parts[0] == "-" {
        let mut text = String::new();
        io::stdin().read_to_string(&mut text).map_err(|e| e.to_string())?;
        return Ok(text);
    }
    Ok(parts.join(" "))
}

fn run(mut args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || take_flag(&mut args, "--help") || take_flag(&mut args, "-h") {
        print!("{USAGE}");
        return Ok(());
    }
    let vault = match take_option(&mut args, "--vault")?.or_else(|| std::env::var("TAGDOWN_VAULT").ok()) {
        Some(path) => PathBuf::from(path),
        None => VaultList::load().active_root()?,
    };
    if args.is_empty() {
        return Err("missing command; see tagdown --help".into());
    }
    let command = args.remove(0);
    if command == "syntax" {
        print!("{SYNTAX}");
        return Ok(());
    }
    let mut lib = Library::open(vault)?;

    match command.as_str() {
        "mcp" => {
            if io::stdin().is_terminal() {
                eprintln!("tagdown: MCP server running on stdin/stdout. Add it to an AI assistant rather than running it here; Ctrl-C to quit.");
            }
            mcp::serve(lib, io::stdin().lock(), io::stdout().lock()).map_err(|e| e.to_string())
        }
        "search" => {
            let limit = take_option(&mut args, "--limit")?.map(|n| n.parse().map_err(|_| "--limit must be a number")).transpose()?.unwrap_or(20);
            let query = args.join(" ");
            if query.trim().is_empty() {
                return Err("search needs a query".into());
            }
            for result in lib.search(&query, limit)? {
                println!("{}  {}", result.note.title, dim(&result.note.id));
                if !result.excerpt.is_empty() {
                    println!("    {}", result.excerpt);
                }
            }
            Ok(())
        }
        "list" => {
            let folder = take_option(&mut args, "--folder")?;
            let tag = take_option(&mut args, "--tag")?;
            let limit = take_option(&mut args, "--limit")?.map(|n| n.parse().map_err(|_| "--limit must be a number")).transpose()?.unwrap_or(usize::MAX);
            for note in lib.list(folder.as_deref(), tag.as_deref(), limit)? {
                let tags = if note.tags.is_empty() { String::new() } else { format!("  #{}", note.tags.join(" #")) };
                println!("{}  {}{}", note.title, dim(&note.updated_at.format("%Y-%m-%d").to_string()), tags);
            }
            Ok(())
        }
        "show" => {
            let view = lib.read(&args.join(" "))?;
            print!("{}", view.content);
            Ok(())
        }
        "new" => {
            let note_type = take_option(&mut args, "--type")?;
            if args.is_empty() {
                return Err("new needs a title".into());
            }
            let title = args.remove(0);
            let body = if args.is_empty() && !io::stdin().is_terminal() { text_arg(&["-".into()])? } else { text_arg(&args)? };
            let note = lib.create_typed(&title, &body, None, &[], note_type.as_deref())?;
            println!("Created \"{}\" ({})", note.title, note.id);
            Ok(())
        }
        "append" => {
            if args.len() < 2 {
                return Err("append needs a note and some text (or - for stdin)".into());
            }
            let note_ref = args.remove(0);
            let note = lib.append(&note_ref, &text_arg(&args)?)?;
            println!("Appended to \"{}\"", note.title);
            Ok(())
        }
        "journal" => {
            let named_day = args.first().filter(|a| resolve_day(Some(a)).is_ok()).cloned();
            if named_day.is_some() {
                args.remove(0);
            }
            let day = resolve_day(named_day.as_deref())?;
            if args.is_empty() && io::stdin().is_terminal() {
                match lib.journal(day)? {
                    Some((_, content)) => print!("{content}"),
                    None => eprintln!("No journal page for {} yet.", day_title(day)),
                }
                return Ok(());
            }
            let text = if args.is_empty() { text_arg(&["-".into()])? } else { text_arg(&args)? };
            let note = lib.append_to_journal(day, &text)?;
            println!("Appended to \"{}\"", note.title);
            Ok(())
        }
        "tasks" => {
            let filter = if take_flag(&mut args, "--all") { TaskFilter::All } else if take_flag(&mut args, "--done") { TaskFilter::Done } else { TaskFilter::Open };
            let tag = take_option(&mut args, "--tag")?;
            let mut current = String::new();
            for task in lib.tasks(filter, tag.as_deref())? {
                if task.note_id != current {
                    println!("{}{}", if current.is_empty() { "" } else { "\n" }, task.note_title);
                    current = task.note_id.clone();
                }
                println!("  [{}] {}", if task.done { "x" } else { " " }, task.text);
            }
            Ok(())
        }
        "query" => {
            let out = lib.query(&args.join(" "))?;
            for note in &out.notes {
                println!("{}  {}", note.title, dim(&note.updated_at.format("%Y-%m-%d").to_string()));
            }
            for task in &out.tasks {
                println!("[{}] {}  {}", if task.done { "x" } else { " " }, task.text, dim(&task.note_title));
            }
            let shown = out.notes.len().max(out.tasks.len());
            if out.total > shown {
                eprintln!("(showing {shown} of {}; add limit:N for more)", out.total);
            }
            Ok(())
        }
        "backlinks" => {
            for backlink in lib.backlinks(&args.join(" "))? {
                println!("{}", backlink.note.title);
                for line in backlink.mentions {
                    println!("    {line}");
                }
            }
            Ok(())
        }
        other => Err(format!("unknown command {other:?}; see tagdown --help")),
    }
}

/// Grey text on a terminal, plain otherwise.
fn dim(text: &str) -> String {
    if io::stdout().is_terminal() { format!("\x1b[2m{text}\x1b[0m") } else { text.to_string() }
}
