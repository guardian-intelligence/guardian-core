defmodule Guardian.Kernel.Supervisor do
  @moduledoc """
  Top-level supervisor for the Guardian kernel.

  Strategy: rest_for_one — if State dies, everything downstream restarts in order.
  """

  use Supervisor

  def start_link(opts \\ []) do
    Supervisor.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(opts) do
    enabled = Keyword.get(opts, :enabled, true)

    children =
      if enabled do
        [
          {Guardian.Kernel.State, []},
          {Task.Supervisor, name: Guardian.Kernel.TaskSupervisor},
          {Guardian.Kernel.WhatsApp.Bridge, []},
          {Guardian.Kernel.WhatsApp.MessageRouter, []},
          {Guardian.Kernel.IpcWatcher, []},
          {Guardian.Kernel.TaskScheduler, []}
        ]
      else
        []
      end

    Supervisor.init(children, strategy: :rest_for_one)
  end
end
